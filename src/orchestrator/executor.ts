/**
 * 计划执行器
 *
 * 执行规划好的任务步骤
 */

import { TaskPlan, PlanStep } from './planner';
import { StepResult } from './mod';
import { SessionContext } from './context';
import { saveScreenshot, findElement } from '../execution/vision';
import { analyzeError, getRecoveryStrategy } from './error-recovery';
import { logger, metrics } from '../observability';

export interface ExecutorConfig {
  guiController?: any;
  cliExecutor?: any;
  browserController?: any;
  fileSystemManager?: any;
  memoryEngine?: any;
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
    this.taskId = context.taskId; // 存储 taskId 供 locateByVision 等方法使用
    const results: StepResult[] = [];

    // 记录任务开始
    logger.taskStart(context.taskId, context.plan.description, 'execute');

    try {
      for (let i = 0; i < context.plan.steps.length && this.isRunning; i++) {
        const step = context.plan.steps[i];
        context.currentStep = i;

        // 检查依赖
        const depsReady = await this.checkDependencies(step, results, context);
        if (!depsReady) {
          const result: StepResult = {
            stepId: step.id,
            type: step.type,
            success: false,
            output: null,
            durationMs: 0,
            error: `Dependencies not met: ${step.dependencies.join(', ')}`,
          };
          results.push(result);

          // 记录步骤失败
          logger.stepEnd(context.taskId, step.id, step.type, false, undefined, result.error);
          metrics.recordStep(step.type, false, 0);
          continue;
        }

        // 执行步骤
        const result = await this.executeStep(step, context, session);
        results.push(result);

        // 存储到会话
        session.storeResult(context.taskId, step.id, result);

        // 失败处理
        if (!result.success) {
          const handled = await this.handleFailure(step, result, context, session, results);
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

      // 记录任务结束
      const successCount = results.filter(r => r.success).length;
      logger.taskEnd(context.taskId, successCount === results.length, results.length, successCount);
      metrics.recordTask(successCount === results.length, Date.now() - context.startTime);
    }

    return results;
  }

  /**
   * 流式执行
   */
  async *executeStream(plan: TaskPlan, session: SessionContext): AsyncGenerator<StepResult> {
    this.isRunning = true;
    const results: StepResult[] = [];
    // executeStream 没有 execute() 构建的完整 context，构造最小可用上下文
    const ctx = { taskId: plan.taskId || 'stream-task' } as ExecutionContext;

    for (const step of plan.steps) {
      if (!this.isRunning) break;

      // 检查依赖
      const depsReady = await this.checkDependencies(step, results, ctx);
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
      const result = await this.executeStep(step, ctx, session);
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

    // 记录步骤开始
    logger.stepStart(context.taskId, step.id, step.type, step.description, step.params);

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
        case 'browser_navigate':
          result = await this.executeBrowserNavigate(step);
          break;
        case 'browser_click':
          result = await this.executeBrowserClick(step);
          break;
        case 'browser_type':
          result = await this.executeBrowserType(step);
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

      const durationMs = Date.now() - startTime;
      const stepResult: StepResult = {
        stepId: step.id,
        type: step.type,
        success: validation.success,
        output: result,
        screenshot: result?.screenshot,
        durationMs,
        error: validation.error,
      };

      // 记录步骤结束
      logger.stepEnd(context.taskId, step.id, step.type, validation.success, result, validation.error);
      metrics.recordStep(step.type, validation.success, durationMs);

      return stepResult;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMsg = error instanceof Error ? error.message : String(error);

      // 记录步骤失败
      logger.stepEnd(context.taskId, step.id, step.type, false, undefined, errorMsg);
      metrics.recordStep(step.type, false, durationMs);

      return {
        stepId: step.id,
        type: step.type,
        success: false,
        output: null,
        durationMs,
        error: errorMsg,
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

    // 执行点击（根据 button 类型选择方法）
    if (button === 'right') {
      return await this.config.guiController.right_click(coords.x, coords.y);
    } else if (button === 'double') {
      return await this.config.guiController.double_click(coords.x, coords.y);
    } else {
      return await this.config.guiController.click(coords.x, coords.y);
    }
  }

  /**
   * 执行 GUI 输入
   */
  private async executeGuiType(step: PlanStep): Promise<any> {
    if (!this.config.guiController) {
      throw new Error('GUI controller not available');
    }

    const { target, text, clearFirst = false } = step.params;

    // 空文本是静默 no-op 的根源：必须快速失败而非打出空串后虚报成功
    if (typeof text !== 'string' || text.length === 0) {
      throw new Error(
        `gui_type step requires non-empty text (use gui_click for clicks, cli_execute for commands): step "${step.id}"`
      );
    }

    if (target) {
      const coords = await this.resolveGuiTarget(target);
      await this.config.guiController.click(coords.x, coords.y);
    }

    if (clearFirst) {
      // Ctrl+A 全选
      await this.config.guiController.key_press('^a');
      await this.delay(100);
    }

    return await this.config.guiController.type_text(text);
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

  private async ensureBrowserLaunched(): Promise<any> {
    if (!this.config.browserController) {
      throw new Error('Browser controller not available');
    }
    if (this.config.browserController.launch) {
      await this.config.browserController.launch();
    }
    return this.config.browserController;
  }

  /**
   * 执行浏览器导航
   */
  private async executeBrowserNavigate(step: PlanStep): Promise<any> {
    const browser = await this.ensureBrowserLaunched();
    const { url } = step.params;
    return await browser.navigate(url);
  }

  /**
   * 执行浏览器点击
   */
  private async executeBrowserClick(step: PlanStep): Promise<any> {
    const browser = await this.ensureBrowserLaunched();
    const { selector } = step.params;
    return await browser.click(selector);
  }

  /**
   * 执行浏览器输入
   */
  private async executeBrowserType(step: PlanStep): Promise<any> {
    const browser = await this.ensureBrowserLaunched();
    const { selector, text, value } = step.params;
    return await browser.typeText(selector, text ?? value ?? '');
  }

  /**
   * 执行内存存储
   */
  private async executeMemoryStore(step: PlanStep, session: SessionContext): Promise<any> {
    const { key, value, scope = 'task', label, category } = step.params;
    
    if (this.config.memoryEngine?.writePage) {
      const pageId = this.config.memoryEngine.writePage(
        typeof value === 'string' ? value : JSON.stringify(value),
        label || key,
        category || scope
      );
      return { stored: true, key, pageId };
    }

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
    const { key, scope = 'task', pageId } = step.params;

    if (this.config.memoryEngine?.loadPage && (pageId || key)) {
      const page = this.config.memoryEngine.loadPage(pageId || key);
      return { retrieved: Boolean(page), key, page };
    }
    
    const value = scope === 'global' 
      ? session.getGlobal(key)
      : session.get(key);
    
    return { retrieved: true, key, value };
  }

  /**
   * 执行条件判断
   */
  private async executeCondition(step: PlanStep, context: ExecutionContext): Promise<any> {
    const { condition, thenSteps: _thenSteps = [], elseSteps: _elseSteps = [] } = step.params;
    
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
      // 第 1 级：UIA 系统级元素定位（最准，零 VLM token）
      if (this.config.guiController?.locateByDescription) {
        try {
          const coords = await this.config.guiController.locateByDescription(target);
          if (coords && typeof coords.x === 'number' && typeof coords.y === 'number') {
            // 记录 UIA 命中
            metrics.recordLocator('uia', true);
            return { x: coords.x, y: coords.y };
          }
        } catch {
          // UIA 定位失败，记录未命中
          metrics.recordLocator('uia', false);

          // 记录 fallback 事件
          logger.locatorFallback(
            this.taskId || 'unknown',
            'current',
            target,
            'UIA',
            'VLM',
            'UIA 未找到元素或无坐标'
          );
        }
      }

      // 第 2 级：视觉定位兜底（处理 UIA 拿不到的画面：canvas、游戏、图片按钮）
      const visual = await this.locateByVision(target);
      if (visual) {
        // 记录 VLM 命中
        metrics.recordLocator('vlm', true);
        return visual;
      } else {
        // 记录 VLM 未命中
        metrics.recordLocator('vlm', false);
      }
    }

    throw new Error(`Cannot resolve target: ${JSON.stringify(target)}`);
  }

  /**
   * 视觉定位：截图 → VLM 找元素 → 返回 bounds 中心点
   */
  private async locateByVision(description: string): Promise<{ x: number; y: number } | null> {
    if (!this.config.guiController?.screenshot) {
      return null;
    }

    try {
      const base64 = await this.config.guiController.screenshot();
      if (!base64) {
        return null;
      }

      const imagePath = await saveScreenshot(base64);
      const sizeKb = Math.round(Buffer.from(base64, 'base64').length / 1024);

      // 记录截图事件
      logger.screenshot(this.taskId || 'unknown', 'locator', imagePath, sizeKb);

      const element = await findElement(imagePath, description);
      if (!element || !element.bounds) {
        return null;
      }

      const { x, y, width, height } = element.bounds;
      return { x: Math.round(x + width / 2), y: Math.round(y + height / 2) };
    } catch {
      return null;
    }
  }

  private taskId: string | null = null;

  /**
   * 检查依赖
   */
  private async checkDependencies(
    step: PlanStep, 
    results: StepResult[],
    _context: ExecutionContext
  ): Promise<boolean> {
    if (step.dependencies.length === 0) return true;

    // 依赖必须存在且成功：未执行或执行失败的依赖都不算满足
    return step.dependencies.every(
      dep => results.find(r => r.stepId === dep)?.success === true
    );
  }

  /**
   * 验证步骤结果
   * GUI 控制器以返回值 {success:false, error} 报告失败而非抛错，
   * 必须在此识别，否则失败会被静默上报为成功。
   */
  private async validateStep(_step: PlanStep, result: any): Promise<{ success: boolean; error?: string }> {
    if (result && typeof result === 'object' && result.success === false) {
      return { success: false, error: result.error || 'action reported failure' };
    }
    return { success: true };
  }

  /**
   * 处理失败（智能恢复）
   */
  private async handleFailure(
    step: PlanStep,
    result: StepResult,
    context: ExecutionContext,
    session: SessionContext,
    results: StepResult[]
  ): Promise<boolean> {
    if (!result.error) {
      return false; // 没有错误信息，无法分析
    }

    // 分析错误类型
    const analysis = analyzeError(result.error, step.type);

    logger.log({
      level: 'warn',
      type: 'error',
      taskId: context.taskId,
      stepId: step.id,
      message: `步骤失败: ${analysis.reason}`,
      data: { category: analysis.category, canRetry: analysis.canRetry, suggestedFix: analysis.suggestedFix },
      tags: ['error_recovery'],
    });

    if (!analysis.canRetry) {
      return false;
    }

    // 获取恢复策略
    const strategy = getRecoveryStrategy(analysis, 1);
    const maxRetries = Math.min(strategy.maxRetries, step.retryConfig?.maxRetries ?? this.config.maxRetries);

    // 尝试智能重试
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      // 记录重试
      logger.retry(context.taskId, step.id, attempt, maxRetries, analysis.category, strategy);

      // 延迟
      await this.delay(strategy.delayMs);

      // 创建修改后的步骤
      const modifiedStep = { ...step };

      // 应用恢复策略
      if (strategy.timeoutMultiplier) {
        modifiedStep.timeoutMs = Math.round(step.timeoutMs * strategy.timeoutMultiplier);
      }

      if (strategy.shouldCaptureScreenshot) {
        modifiedStep.captureScreenshot = true;
      }

      // 重试执行
      const retryResult = await this.executeStep(modifiedStep, context, session);

      if (retryResult.success) {
        // 记录重试成功
        metrics.recordRetry(analysis.category, true);
        // 用重试结果替换失败结果，否则最终报告与依赖检查仍看到原始失败
        const idx = results.findIndex(r => r.stepId === step.id);
        if (idx >= 0) {
          results[idx] = retryResult;
        }
        session.storeResult(context.taskId, step.id, retryResult);
        return true;
      } else {
        // 记录重试失败
        metrics.recordRetry(analysis.category, false);
      }
    }

    return false;
  }

  /**
   * 反思并调整
   */
  private async reflectAndAdjust(
    _context: ExecutionContext,
    _results: StepResult[],
    _session: SessionContext
  ): Promise<void> {
    // 分析执行状态，必要时调整计划
    // TODO: 实现自适应调整逻辑
  }

  /**
   * 评估条件
   */
  private async evaluateCondition(_condition: string, _context: ExecutionContext): Promise<boolean> {
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
