/**
 * 结构化日志 - JSON Lines 格式
 *
 * 每个事件一行 JSON，便于解析、查询、可视化
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type EventType =
  | 'task_start'
  | 'task_end'
  | 'plan_start'
  | 'plan_end'
  | 'step_start'
  | 'step_end'
  | 'retry'
  | 'error'
  | 'screenshot'
  | 'locator_fallback';

export interface LogEvent {
  timestamp: string; // ISO 8601
  level: LogLevel;
  type: EventType;
  taskId?: string;
  stepId?: string;
  message: string;
  data?: Record<string, any>;
  error?: string;
  durationMs?: number;
  tags?: string[];
}

export class StructuredLogger {
  private taskId: string | null = null;
  private startTimes = new Map<string, number>();

  /**
   * 设置当前任务 ID（用于后续日志关联）
   */
  setTaskId(taskId: string): void {
    this.taskId = taskId;
  }

  /**
   * 记录事件
   */
  log(event: Omit<LogEvent, 'timestamp'>): void {
    const logEvent: LogEvent = {
      timestamp: new Date().toISOString(),
      ...event,
      taskId: event.taskId || this.taskId || undefined,
    };

    // 输出 JSON Lines 格式（单行 JSON）
    console.log(JSON.stringify(logEvent));
  }

  /**
   * 任务开始
   */
  taskStart(taskId: string, description: string, mode: string): void {
    this.taskId = taskId;
    this.startTimes.set(`task_${taskId}`, Date.now());

    this.log({
      level: 'info',
      type: 'task_start',
      message: `任务开始: ${description}`,
      data: { mode },
      tags: ['task'],
    });
  }

  /**
   * 任务结束
   */
  taskEnd(taskId: string, success: boolean, stepCount: number, successCount: number): void {
    const startTime = this.startTimes.get(`task_${taskId}`);
    const durationMs = startTime ? Date.now() - startTime : undefined;

    this.log({
      level: success ? 'info' : 'error',
      type: 'task_end',
      message: `任务${success ? '成功' : '失败'}: ${successCount}/${stepCount} 步骤`,
      data: {
        success,
        stepCount,
        successCount,
        successRate: stepCount > 0 ? successCount / stepCount : 0,
      },
      durationMs,
      tags: ['task', success ? 'success' : 'failure'],
    });

    this.startTimes.delete(`task_${taskId}`);
    this.taskId = null;
  }

  /**
   * 规划开始
   */
  planStart(taskId: string, description: string): void {
    this.startTimes.set(`plan_${taskId}`, Date.now());

    this.log({
      level: 'info',
      type: 'plan_start',
      taskId,
      message: '开始生成执行计划',
      data: { description },
      tags: ['planner'],
    });
  }

  /**
   * 规划结束
   */
  planEnd(taskId: string, success: boolean, stepCount?: number, error?: string): void {
    const startTime = this.startTimes.get(`plan_${taskId}`);
    const durationMs = startTime ? Date.now() - startTime : undefined;

    this.log({
      level: success ? 'info' : 'error',
      type: 'plan_end',
      taskId,
      message: success ? `计划生成成功: ${stepCount} 步骤` : '计划生成失败',
      data: success ? { stepCount } : undefined,
      error,
      durationMs,
      tags: ['planner', success ? 'success' : 'failure'],
    });

    this.startTimes.delete(`plan_${taskId}`);
  }

  /**
   * 步骤开始
   */
  stepStart(taskId: string, stepId: string, type: string, description: string, params: any): void {
    this.startTimes.set(`step_${stepId}`, Date.now());

    this.log({
      level: 'debug',
      type: 'step_start',
      taskId,
      stepId,
      message: `[${type}] ${description}`,
      data: { type, params },
      tags: ['executor', type],
    });
  }

  /**
   * 步骤结束
   */
  stepEnd(
    taskId: string,
    stepId: string,
    type: string,
    success: boolean,
    output?: any,
    error?: string
  ): void {
    const startTime = this.startTimes.get(`step_${stepId}`);
    const durationMs = startTime ? Date.now() - startTime : undefined;

    this.log({
      level: success ? 'debug' : 'warn',
      type: 'step_end',
      taskId,
      stepId,
      message: success ? `步骤成功` : `步骤失败: ${error}`,
      data: success ? { type, output } : { type },
      error,
      durationMs,
      tags: ['executor', type, success ? 'success' : 'failure'],
    });

    this.startTimes.delete(`step_${stepId}`);
  }

  /**
   * 重试事件
   */
  retry(
    taskId: string,
    stepId: string,
    attempt: number,
    maxRetries: number,
    category: string,
    strategy: any
  ): void {
    this.log({
      level: 'warn',
      type: 'retry',
      taskId,
      stepId,
      message: `重试 ${attempt}/${maxRetries} (${category})`,
      data: { attempt, maxRetries, category, strategy },
      tags: ['error_recovery', category],
    });
  }

  /**
   * 错误事件
   */
  error(taskId: string | undefined, stepId: string | undefined, message: string, error: Error): void {
    this.log({
      level: 'error',
      type: 'error',
      taskId,
      stepId,
      message,
      error: error.message,
      data: { stack: error.stack },
      tags: ['error'],
    });
  }

  /**
   * 截图事件
   */
  screenshot(taskId: string, stepId: string, path: string, sizeKb: number): void {
    this.log({
      level: 'debug',
      type: 'screenshot',
      taskId,
      stepId,
      message: `截图保存: ${path}`,
      data: { path, sizeKb },
      tags: ['vision'],
    });
  }

  /**
   * 定位器 fallback 事件（UIA → VLM）
   */
  locatorFallback(
    taskId: string,
    stepId: string,
    target: string,
    fromLevel: string,
    toLevel: string,
    reason: string
  ): void {
    this.log({
      level: 'info',
      type: 'locator_fallback',
      taskId,
      stepId,
      message: `定位 fallback: ${fromLevel} → ${toLevel}`,
      data: { target, fromLevel, toLevel, reason },
      tags: ['locator', 'fallback'],
    });
  }
}

/**
 * 全局单例
 */
export const logger = new StructuredLogger();
