/**
 * 任务规划器
 * 
 * 将任务分析转换为可执行步骤
 */

import { v4 as uuidv4 } from 'uuid';

export interface PlanParams {
  taskId: string;
  description: string;
  analysis: any;
  mode: 'gui' | 'cli' | 'auto';
  context: any;
}

export interface TaskPlan {
  taskId: string;
  version: string;
  description: string;
  steps: PlanStep[];
  dependencies: Map<string, string[]>;
  rollbackSteps?: PlanStep[];
}

export interface PlanStep {
  id: string;
  type: StepType;
  description: string;
  params: StepParams;
  dependencies: string[];
  retryConfig: RetryConfig;
  timeoutMs: number;
  captureScreenshot: boolean;
  validation?: ValidationRule[];
  /** 失败后动作（仅流式执行消费）：skip=失败后继续后续步骤；默认 abort */
  failureAction?: 'skip' | 'abort';
}

export type StepType = 
  | 'gui_click'
  | 'gui_type'
  | 'gui_scroll'
  | 'gui_drag'
  | 'gui_wait_for'
  | 'gui_screenshot'
  | 'cli_execute'
  | 'cli_execute_parsed'
  | 'cli_spawn'
  | 'cli_kill'
  | 'browser_navigate'
  | 'browser_click'
  | 'browser_type'
  | 'llm_decide'
  | 'llm_extract'
  | 'memory_store'
  | 'memory_retrieve'
  | 'condition'
  | 'loop'
  | 'parallel'
  | 'wait'
  | 'custom';

export interface StepParams {
  [key: string]: any;
}

export interface RetryConfig {
  maxRetries: number;
  backoffMs: number;
  onRetry?: string;
}

export interface ValidationRule {
  type: 'screenshot_match' | 'element_exists' | 'text_contains' | 'exit_code' | 'json_schema';
  params: any;
  failureAction: 'retry' | 'rollback' | 'skip' | 'abort';
}

/**
 * 任务规划器
 */
export class TaskPlanner {
  private llmGateway: any;

  constructor(llmGateway: any) {
    this.llmGateway = llmGateway;
  }

  /**
   * 创建执行计划
   */
  async createPlan(params: PlanParams): Promise<TaskPlan> {
    const systemPrompt = `You are a task planner for a Computer Use Agent.
Convert the task analysis into a detailed execution plan.

Available step types:
- gui_click: Click on screen element
- gui_type: Type text at location
- gui_scroll: Scroll at location
- gui_wait_for: Wait for element to appear
- gui_screenshot: Capture screenshot
- cli_execute: Execute shell command
- cli_execute_parsed: Execute and parse structured output
- cli_spawn: Start background process
- browser_navigate: Navigate to URL
- browser_click: Click on web element
- llm_decide: Use LLM to make decision
- llm_extract: Use LLM to extract information
- condition: Branch based on condition
- wait: Pause execution

Rules:
1. Use GUI operations for interacting with applications
2. Use CLI operations for system commands
3. Use browser operations for web automation
4. Add validation steps after critical operations
5. Set appropriate timeouts (default: 30000ms for GUI, 60000ms for CLI)
6. Define dependencies clearly
7. Plan rollback steps for critical operations

Respond in JSON format matching the TaskPlan interface.`;

    const prompt = `Create execution plan for:
Description: ${params.description}
Mode: ${params.mode}
Analysis: ${JSON.stringify(params.analysis)}
Context: ${JSON.stringify(params.context)}

Generate plan with steps that can be executed by the system.`;

    const response = await this.llmGateway.complete({
      system: systemPrompt,
      prompt,
      format: 'json',
    });

    let planData: any;
    try {
      planData = JSON.parse(response.content);
    } catch {
      throw new Error(`LLM returned invalid JSON: ${response.content.slice(0, 200)}`);
    }
    if (!Array.isArray(planData.steps)) {
      throw new Error('plan JSON is missing the steps array');
    }

    // 依赖图必须基于 enrich 后的步骤构建：原始步骤可能缺 id，
    // enrich 会生成 step_N_xxx 形式的 id，两者对不上会让依赖图变成垃圾数据
    const enrichedSteps = this.validateAndEnrichSteps(planData.steps);

    return {
      taskId: params.taskId,
      version: '2.0',
      description: params.description,
      steps: enrichedSteps,
      dependencies: this.buildDependencyMap(enrichedSteps),
      rollbackSteps: planData.rollbackSteps,
    };
  }

  /**
   * 验证和丰富步骤
   */
  protected validateAndEnrichSteps(steps: any[]): PlanStep[] {
    return steps.map((step, index) => ({
      id: step.id || `step_${index}_${uuidv4().slice(0, 8)}`,
      type: step.type as StepType,
      description: step.description || `${step.type} operation`,
      params: step.params || {},
      dependencies: step.dependencies || [],
      retryConfig: {
        maxRetries: step.retryConfig?.maxRetries ?? 3,
        backoffMs: step.retryConfig?.backoffMs ?? 1000,
        onRetry: step.retryConfig?.onRetry,
      },
      timeoutMs: step.timeoutMs ?? this.getDefaultTimeout(step.type),
      captureScreenshot: step.captureScreenshot ?? true,
      validation: step.validation || [],
    }));
  }

  /**
   * 获取默认超时时间
   */
  private getDefaultTimeout(stepType: string): number {
    if (stepType.startsWith('gui_')) return 30000;
    if (stepType.startsWith('cli_')) return 60000;
    if (stepType.startsWith('browser_')) return 30000;
    if (stepType === 'llm_decide' || stepType === 'llm_extract') return 10000;
    return 30000;
  }

  /**
   * 构建依赖图
   */
  protected buildDependencyMap(steps: PlanStep[]): Map<string, string[]> {
    const map = new Map<string, string[]>();
    for (const step of steps) {
      map.set(step.id, step.dependencies);
    }
    return map;
  }

  /**
   * 优化计划
   * 注意：mergeShortSteps 产出的 'parallel' 批量步骤当前不被执行器支持
   * （executeStep 无该 case），且会破坏依赖边。在实现 executor 端
   * 'parallel' 支持之前，本方法保持恒等变换，不做合并。
   */
  async optimizePlan(plan: TaskPlan): Promise<TaskPlan> {
    return plan;
  }

  /**
   * 识别可并行步骤组
   */
  private identifyParallelGroups(plan: TaskPlan): string[][] {
    const groups: string[][] = [];
    const executed = new Set<string>();
    
    while (executed.size < plan.steps.length) {
      const group: string[] = [];
      
      for (const step of plan.steps) {
        if (executed.has(step.id)) continue;
        
        // 检查所有依赖是否已完成
        const depsReady = step.dependencies.every(dep => executed.has(dep));
        if (depsReady) {
          group.push(step.id);
        }
      }
      
      if (group.length > 0) {
        groups.push(group);
        group.forEach(id => executed.add(id));
      } else {
        // 依赖无法满足（引用不存在的步骤或循环依赖）——必须终止，否则死循环
        const remaining = plan.steps.filter(s => !executed.has(s.id)).map(s => s.id);
        throw new Error(`unresolvable step dependencies: ${remaining.join(', ')}`);
      }
    }
    
    return groups;
  }

  /**
   * 合并短步骤
   */
  private mergeShortSteps(steps: PlanStep[]): PlanStep[] {
    // 连续的 GUI 操作可以合并
    const merged: PlanStep[] = [];
    let currentBatch: PlanStep[] = [];

    for (const step of steps) {
      if (this.isGUiAction(step) && currentBatch.length < 5) {
        currentBatch.push(step);
      } else {
        if (currentBatch.length > 1) {
          merged.push(this.createBatchStep(currentBatch));
        } else if (currentBatch.length === 1) {
          merged.push(currentBatch[0]);
        }
        currentBatch = [];
        merged.push(step);
      }
    }

    // 处理剩余的批次
    if (currentBatch.length > 1) {
      merged.push(this.createBatchStep(currentBatch));
    } else if (currentBatch.length === 1) {
      merged.push(currentBatch[0]);
    }

    return merged;
  }

  /**
   * 判断是否为 GUI 操作
   */
  private isGUiAction(step: PlanStep): boolean {
    return ['gui_click', 'gui_type', 'gui_scroll'].includes(step.type);
  }

  /**
   * 创建批量步骤
   */
  private createBatchStep(steps: PlanStep[]): PlanStep {
    return {
      id: `batch_${uuidv4().slice(0, 8)}`,
      type: 'parallel',
      description: `Batch of ${steps.length} GUI actions`,
      params: { steps },
      dependencies: [],
      retryConfig: { maxRetries: 1, backoffMs: 500 },
      timeoutMs: steps.reduce((sum, s) => sum + s.timeoutMs, 0),
      captureScreenshot: true,
    };
  }
}
