/**
 * 计划执行器
 * 
 * 执行规划好的任务步骤
 */

import { TaskPlan, PlanStep, StepResult } from './planner';
import { SessionContext } from './context';

export interface ExecutorConfig {
  guiController?: any;
  cliExecutor?: any;
  maxRetries?: number;
  enableReflection?: boolean;
}

export interface ExecutionContext {
  taskId: string;
  plan: TaskPlan;
  request: any;
  startTime: number;
  currentStep: number;
  results: StepResult[];
}

/**
 * 计划执行器
 */
export class PlanExecutor {
  private config: ExecutorConfig;
  private isRunning = false;

  constructor(config: ExecutorConfig) {
    this.config = {
      maxRetries: 3,
      enableReflection: true,
      ...config,
    };
  }

  /**
   * 执行计划
   */
  async execute(context: ExecutionContext, session: SessionContext): Promise<StepResult[]> {
    this.isRunning = true;
    const results: StepResult[] = [];

    try {
      for (let i = 0; i < context.plan.steps.length && this.isRunning; i++) {
        const step = context.plan.steps[i];
        context.currentStep = i;

        // 检查依赖
        const depsReady = await this.checkDependencies(step, results, context);
        if (!depsReady) {
          results.push({
            stepId: step.id,
            type: step.type,
            success: false,
            output: null,
            durationMs: 0,
            error: `Dependencies not met: ${step.dependencies.join(', ')}`,
          });
          continue;
        }

        // 执行步骤
        const result = await this.executeStep(step, context, session);
        results.push(result);

        // 存储到会话
        session.storeResult(context.taskId, step.id, result);

        // 失败处理
        if (!result.success) {
          const handled = await this.handleFailure(step, result, context, session);
          if (!handled) {
            break;
          }
        }

        // 反思（如果启用）
        if (this.config.enableReflection && i % 3 === 0) {
          await this.reflectAndAdjust(context, results, session);
        }
      }
    } finally {
      this.isRunning = false;
    }

    return results;
  }

  /**
   * 流式执行
   */
  async *executeStream(plan: TaskPlan, session: SessionContext): AsyncGenerator<StepResult> {
    this.isRunning = true;
    const results: StepResult[] = [];

    for (const step of plan.steps) {
      if (!this.isRunning) break;

      // 检查依赖
      const depsReady = await this.checkDependencies(step, results, null as any);
      if (!depsReady) {
        const result: StepResult = {
          stepId: step.id,
          type: step.type,
          success: false,
          output: null,
          durationMs: 0,
          error: `Dependencies not met`,
        };
        results.push(result);
        yield result;
        continue;
      }

      // 执行步骤
      const result = await this.executeStep(step, null as any, session);
      results.push(result);
      yield result;

      // 如果失败且无法重试，停止执行
      if (!result.success) {
        const shouldContinue = await this.shouldContinueAfterFailure(step, result);
        if (!shouldContinue) {
          break;
        }
      }
    }

    this.isRunning = false;
  }

  /**
   * 执行单个步骤
   */
  private async executeStep(
    step: PlanStep, 
    context: ExecutionContext,
    session: SessionContext
  ): Promise<StepResult> {
    const startTime = Date.now();

    try {
      let result: any;

      switch (step.type) {
        case 'gui_click':
          result = await this.executeGuiClick(step);
          break;
        case 'gui_type':
          result = await this.executeGuiType(step);
          break;
        case 'gui_wait_for':
          result = await this.executeGuiWaitFor(step);
          break;
        case 'gui_screenshot':
          result = await this.executeGuiScreenshot(step);
          break;
        case 'cli_execute':
          result = await this.executeCliCommand(step);
          break;
        case 'cli_execute_parsed':
          result = await this.executeCliParsed(step);
          break;
        case 'memory_store':
          result = await this.executeMemoryStore(step, session);
          break;
        case 'memory_retrieve':
          result = await this.executeMemoryRetrieve(step, session);
          break;
        case 'condition':
          result = await this.executeCondition(step, context);
          break;
        case 'wait':
          await this.delay(step.params.durationMs || 1000);
          result = { waited: true };
          break;
        default:
          throw new Error(`Unknown step type: ${step.type}`);
      }

      // 验证结果
      const validation = await this.validateStep(step, result);

      return {
        stepId: step.id,
        type: step.type,
        success: validation.success,
        output: result,
        screenshot: result?.screenshot,
        durationMs: Date.now() - startTime,
        error: validation.error,
      };
    } catch (error) {
      return {
        stepId: step.id,
        type: step.type,
        success: false,
        output: null,
        durationMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 执行 GUI 点击
   */
  private async executeGuiClick(step: PlanStep): Promise<any> {
    if (!this.config.guiController) {
      throw new Error('GUI controller not available');
    }

    const { target, button = 'left' } = step.params;
    
    // 解析目标
    const coords = await this.resolveGuiTarget(target);
    
    // 执行点击
    return await this.config.guiController.click(coords.x, coords.y, button);
  }

  /**
   * 执行 GUI 输入
   */
  private async executeGuiType(step: PlanStep): Promise<any> {
    if (!this.config.guiController) {
      throw new Error('GUI controller not available');
    }

    const { target, text, clearFirst = false } = step.params;
    
    if (target) {
      const coords = await this.resolveGuiTarget(target);
      await this.config.guiController.click(coords.x, coords.y);
    }

    if (clearFirst) {
      await this.config.guiController.keyCombo('ctrl', 'a');
      await this.delay(100);
    }

    return await this.config.guiController.typeText(text);
  }

  /**
   * 等待 GUI 元素
   */
  private async executeGuiWaitFor(step: PlanStep): Promise<any> {
    if (!this.config.guiController) {
      throw new Error('GUI controller not available');
    }

    const { target, timeout = 30000 } = step.params;
    const start = Date.now();

    while (Date.now() - start < timeout) {
      try {
        const coords = await this.resolveGuiTarget(target);
        return { found: true, x: coords.x, y: coords.y };
      } catch {
        await this.delay(500);
      }
    }

    throw new Error(`Element not found within ${timeout}ms`);
  }

  /**
   * 执行 GUI 截图
   */
  private async executeGuiScreenshot(step: PlanStep): Promise<any> {
    if (!this.config.guiController) {
      throw new Error('GUI controller not available');
    }

    return await this.config.guiController.screenshot();
  }

  /**
   * 执行 CLI 命令
   */
  private async executeCliCommand(step: PlanStep): Promise<any> {
    if (!this.config.cliExecutor) {
      throw new Error('CLI executor not available');
    }

    const { command, cwd, env, timeout = 60000 } = step.params;

    return await this.config.cliExecutor.execute({
      command,
      cwd,
      env,
      timeout,
      captureOutput: true,
    });
  }

  /**
   * 执行 CLI 命令并解析输出
   */
  private async executeCliParsed(step: PlanStep): Promise<any> {
    if (!this.config.cliExecutor) {
      throw new Error('CLI executor not available');
    }

    const { command, cwd, env, timeout = 60000, parseFormat = 'json' } = step.params;

    return await this.config.cliExecutor.executeAndParse({
      command,
      cwd,
      env,
      timeout,
      parseFormat,
    });
  }

  /**
   * 执行内存存储
   */
  private async executeMemoryStore(step: PlanStep, session: SessionContext): Promise<any> {
    const { key, value, scope = 'task' } = step.params;
    
    if (scope === 'global') {
      session.setGlobal(key, value);
    } else {
      session.set(key, value);
    }
    
    return { stored: true, key };
  }

  /**
   * 执行内存检索
   */
  private async executeMemoryRetrieve(step: PlanStep, session: SessionContext): Promise<any> {
    const { key, scope = 'task' } = step.params;
    
    const value = scope === 'global' 
      ? session.getGlobal(key)
      : session.get(key);
    
    return { retrieved: true, key, value };
  }

  /**
   * 执行条件判断
   */
  private async executeCondition(step: PlanStep, context: ExecutionContext): Promise<any> {
    const { condition, thenSteps = [], elseSteps = [] } = step.params;
    
    const result = await this.evaluateCondition(condition, context);
    
    return {
      condition,
      result,
      executedBranch: result ? 'then' : 'else',
    };
  }

  /**
   * 解析 GUI 目标
   */
  private async resolveGuiTarget(target: any): Promise<{ x: number; y: number }> {
    if (!target) {
      throw new Error('Target is required');
    }

    if (typeof target === 'object' && 'x' in target && 'y' in target) {
      return { x: target.x, y: target.y };
    }

    if (typeof target === 'string') {
      // 可能是元素描述，使用视觉定位
      if (this.config.guiController?.locateByDescription) {
        return await this.config.guiController.locateByDescription(target);
      }
    }

    throw new Error(`Cannot resolve target: ${JSON.stringify(target)}`);
  }

  /**
   * 检查依赖
   */
  private async checkDependencies(
    step: PlanStep, 
    results: StepResult[],
    context: ExecutionContext
  ): Promise<boolean> {
    if (step.dependencies.length === 0) return true;

    const completedIds = new Set(results.map(r => r.stepId));
    return step.dependencies.every(dep => completedIds.has(dep) || 
      results.find(r => r.stepId === dep)?.success);
  }

  /**
   * 验证步骤结果
   */
  private async validateStep(step: PlanStep, result: any): Promise<{ success: boolean; error?: string }> {
    if (!step.validation || step.validation.length === 0) {
      return { success: true };
    }

    for (const rule of step.validation) {
      switch (rule.type) {
        case 'exit_code':
          if (result?.exitCode !== 0) {
            return { success: false, error: `Exit code: ${result?.exitCode}` };
          }
          break;
        case 'element_exists':
          // 验证元素存在
          break;
        case 'text_contains':
          if (!result?.stdout?.includes(rule.params.text)) {
            return { success: false, error: `Text not found: ${rule.params.text}` };
          }
          break;
      }
    }

    return { success: true };
  }

  /**
   * 处理失败
   */
  private async handleFailure(
    step: PlanStep,
    result: StepResult,
    context: ExecutionContext,
    session: SessionContext
  ): Promise<boolean> {
    // 尝试重试
    for (let i = 0; i < step.retryConfig.maxRetries; i++) {
      await this.delay(step.retryConfig.backoffMs * (i + 1));
      
      const retryResult = await this.executeStep(step, context, session);
      if (retryResult.success) {
        return true;
      }
    }

    return false;
  }

  /**
   * 反思并调整
   */
  private async reflectAndAdjust(
    context: ExecutionContext,
    results: StepResult[],
    session: SessionContext
  ): Promise<void> {
    // 分析执行状态，必要时调整计划
    // TODO: 实现自适应调整逻辑
  }

  /**
   * 评估条件
   */
  private async evaluateCondition(condition: string, context: ExecutionContext): Promise<boolean> {
    // 简单条件评估
    // TODO: 实现更复杂的条件表达式解析
    return true;
  }

  /**
   * 失败后是否继续
   */
  private async shouldContinueAfterFailure(step: PlanStep, result: StepResult): Promise<boolean> {
    // 检查步骤的 failureAction
    return false;
  }

  /**
   * 延迟
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 停止执行
   */
  stop(): void {
    this.isRunning = false;
  }

  /**
   * 清理资源
   */
  async dispose(): Promise<void> {
    this.stop();
    // 清理资源
  }
}
