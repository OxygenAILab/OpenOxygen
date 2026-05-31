/**
 * 任务编排器
 * 
 * 将自然语言转换为可执行任务图
 * 核心设计原则：用户只需描述目标，系统自动编排任务
 */

export * from './planner';
export * from './executor';
export * from './context';

import { TaskPlanner, TaskPlan } from './planner';
import { PlanExecutor, ExecutionContext } from './executor';
import { SessionContext } from './context';

export interface OrchestratorConfig {
  llmGateway: LLMGateway;
  guiController?: any; // Rust binding
  cliExecutor?: any; // Rust binding
  maxRetries?: number;
  enableReflection?: boolean;
}

export interface TaskRequest {
  description: string;
  context?: string;
  constraints?: string[];
  priority?: 'critical' | 'high' | 'normal' | 'low';
  mode?: 'gui' | 'cli' | 'auto';
}

export interface TaskResponse {
  taskId: string;
  plan: TaskPlan;
  status: 'pending' | 'running' | 'completed' | 'failed';
  results: StepResult[];
  summary?: string;
}

export interface StepResult {
  stepId: string;
  type: string;
  success: boolean;
  output: any;
  screenshot?: string;
  durationMs: number;
  error?: string;
}

/**
 * OpenOxygen 任务编排器
 */
export class TaskOrchestrator {
  private planner: TaskPlanner;
  private executor: PlanExecutor;
  private context: SessionContext;
  private config: OrchestratorConfig;

  constructor(config: OrchestratorConfig) {
    this.config = config;
    this.planner = new TaskPlanner(config.llmGateway);
    this.executor = new PlanExecutor({
      guiController: config.guiController,
      cliExecutor: config.cliExecutor,
      maxRetries: config.maxRetries ?? 3,
      enableReflection: config.enableReflection ?? true,
    });
    this.context = new SessionContext();
  }

  /**
   * 执行自然语言任务
   */
  async execute(request: TaskRequest): Promise<TaskResponse> {
    const taskId = this.generateTaskId();
    
    // 1. 任务理解 - 使用 LLM 分析用户意图
    const taskAnalysis = await this.analyzeTask(request);
    
    // 2. 任务规划 - 生成执行计划
    const plan = await this.planner.createPlan({
      taskId,
      description: request.description,
      analysis: taskAnalysis,
      mode: request.mode ?? 'auto',
      context: this.context.getSnapshot(),
    });

    // 3. 执行计划
    const executionContext: ExecutionContext = {
      taskId,
      plan,
      request,
      startTime: Date.now(),
      currentStep: 0,
      results: [],
    };

    const results = await this.executor.execute(executionContext, this.context);

    // 4. 生成摘要
    const summary = await this.generateSummary(taskId, plan, results);

    return {
      taskId,
      plan,
      status: this.determineStatus(results),
      results,
      summary,
    };
  }

  /**
   * 流式执行任务
   */
  async *executeStream(request: TaskRequest): AsyncGenerator<StepResult> {
    const taskId = this.generateTaskId();
    
    yield { 
      stepId: 'init', 
      type: 'info', 
      success: true, 
      output: { message: `Task ${taskId} initialized` },
      durationMs: 0,
    };

    const plan = await this.planner.createPlan({
      taskId,
      description: request.description,
      analysis: await this.analyzeTask(request),
      mode: request.mode ?? 'auto',
      context: this.context.getSnapshot(),
    });

    yield {
      stepId: 'plan',
      type: 'plan',
      success: true,
      output: plan,
      durationMs: 0,
    };

    for await (const result of this.executor.executeStream(plan, this.context)) {
      yield result;
    }
  }

  /**
   * 分析任务意图
   */
  private async analyzeTask(request: TaskRequest): Promise<TaskAnalysis> {
    const systemPrompt = `You are a task analyzer for a Computer Use Agent.
Analyze the user's request and extract:
1. Main objective
2. Required actions (GUI, CLI, or both)
3. Key constraints
4. Expected outputs
5. Potential risks

Respond in JSON format.`;

    const prompt = `Task: ${request.description}
Context: ${request.context ?? 'None'}
Constraints: ${request.constraints?.join(', ') ?? 'None'}

Provide analysis as JSON with keys: objective, actions, constraints, expectedOutputs, risks`;

    const response = await this.config.llmGateway.complete({
      system: systemPrompt,
      prompt,
      format: 'json',
    });

    return JSON.parse(response.content);
  }

  /**
   * 生成任务摘要
   */
  private async generateSummary(
    taskId: string, 
    plan: TaskPlan, 
    results: StepResult[]
  ): Promise<string> {
    const successCount = results.filter(r => r.success).length;
    const failedCount = results.length - successCount;

    const prompt = `Summarize this task execution:
Task ID: ${taskId}
Plan: ${JSON.stringify(plan)}
Results: ${successCount} succeeded, ${failedCount} failed
Details: ${JSON.stringify(results.slice(-3))}  // Last 3 results

Provide a concise summary (1-2 sentences) of what was accomplished.`;

    const response = await this.config.llmGateway.complete({ prompt });
    return response.content;
  }

  /**
   * 确定任务状态
   */
  private determineStatus(results: StepResult[]): TaskResponse['status'] {
    if (results.length === 0) return 'pending';
    if (results.every(r => r.success)) return 'completed';
    if (results.some(r => !r.success && !r.error?.includes('retry'))) return 'failed';
    return 'running';
  }

  /**
   * 生成任务 ID
   */
  private generateTaskId(): string {
    return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 获取会话上下文
   */
  getContext(): SessionContext {
    return this.context;
  }

  /**
   * 清理资源
   */
  async dispose(): Promise<void> {
    await this.executor.dispose();
    this.context.clear();
  }
}

// Type definitions
interface TaskAnalysis {
  objective: string;
  actions: string[];
  constraints: string[];
  expectedOutputs: string[];
  risks: string[];
}

interface LLMGateway {
  complete(params: { system?: string; prompt: string; format?: string }): Promise<{ content: string }>;
  completeWithTools(params: { prompt: string; tools: any[] }): Promise<{ content: string; toolCalls?: any[] }>;
}
