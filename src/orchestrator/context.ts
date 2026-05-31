/**
 * 会话上下文管理
 * 
 * 管理任务执行过程中的状态和记忆
 */

import { v4 as uuidv4 } from 'uuid';

export interface ContextSnapshot {
  sessionId: string;
  timestamp: number;
  taskResults: Map<string, any>;
  globalData: Map<string, any>;
  workingDirectory: string;
  activeApplications: string[];
  recentScreenshots: string[];
}

/**
 * 会话上下文
 */
export class SessionContext {
  private sessionId: string;
  private taskResults: Map<string, any>;
  private globalData: Map<string, any>;
  private workingDirectory: string;
  private activeApplications: Set<string>;
  private recentScreenshots: string[];
  private maxScreenshots = 10;

  constructor() {
    this.sessionId = uuidv4();
    this.taskResults = new Map();
    this.globalData = new Map();
    this.workingDirectory = process.cwd();
    this.activeApplications = new Set();
    this.recentScreenshots = [];
  }

  /**
   * 存储任务结果
   */
  storeResult(taskId: string, stepId: string, result: any): void {
    const key = `${taskId}:${stepId}`;
    this.taskResults.set(key, {
      ...result,
      storedAt: Date.now(),
    });
  }

  /**
   * 获取任务结果
   */
  getResult(taskId: string, stepId: string): any {
    const key = `${taskId}:${stepId}`;
    return this.taskResults.get(key);
  }

  /**
   * 获取任务的所有结果
   */
  getTaskResults(taskId: string): Map<string, any> {
    const results = new Map<string, any>();
    for (const [key, value] of this.taskResults.entries()) {
      if (key.startsWith(`${taskId}:`)) {
        const stepId = key.split(':')[1];
        results.set(stepId, value);
      }
    }
    return results;
  }

  /**
   * 设置上下文变量
   */
  set(key: string, value: any): void {
    this.globalData.set(key, {
      value,
      updatedAt: Date.now(),
    });
  }

  /**
   * 获取上下文变量
   */
  get(key: string): any {
    const entry = this.globalData.get(key);
    return entry?.value;
  }

  /**
   * 删除上下文变量
   */
  delete(key: string): boolean {
    return this.globalData.delete(key);
  }

  /**
   * 设置全局变量（跨会话持久化）
   */
  setGlobal(key: string, value: any): void {
    // TODO: 持久化到存储
    this.set(`global:${key}`, value);
  }

  /**
   * 获取全局变量
   */
  getGlobal(key: string): any {
    return this.get(`global:${key}`);
  }

  /**
   * 获取工作目录
   */
  getWorkingDirectory(): string {
    return this.workingDirectory;
  }

  /**
   * 设置工作目录
   */
  setWorkingDirectory(dir: string): void {
    this.workingDirectory = dir;
  }

  /**
   * 注册活动应用
   */
  registerApplication(appName: string): void {
    this.activeApplications.add(appName);
  }

  /**
   * 注销活动应用
   */
  unregisterApplication(appName: string): void {
    this.activeApplications.delete(appName);
  }

  /**
   * 获取活动应用列表
   */
  getActiveApplications(): string[] {
    return Array.from(this.activeApplications);
  }

  /**
   * 添加截图
   */
  addScreenshot(screenshotBase64: string): void {
    this.recentScreenshots.push(screenshotBase64);
    if (this.recentScreenshots.length > this.maxScreenshots) {
      this.recentScreenshots.shift();
    }
  }

  /**
   * 获取最近截图
   */
  getRecentScreenshots(count?: number): string[] {
    return this.recentScreenshots.slice(-(count ?? this.maxScreenshots));
  }

  /**
   * 获取最近一张截图
   */
  getLastScreenshot(): string | undefined {
    return this.recentScreenshots[this.recentScreenshots.length - 1];
  }

  /**
   * 获取上下文快照
   */
  getSnapshot(): ContextSnapshot {
    return {
      sessionId: this.sessionId,
      timestamp: Date.now(),
      taskResults: new Map(this.taskResults),
      globalData: new Map(this.globalData),
      workingDirectory: this.workingDirectory,
      activeApplications: Array.from(this.activeApplications),
      recentScreenshots: [...this.recentScreenshots],
    };
  }

  /**
   * 从快照恢复
   */
  restoreFromSnapshot(snapshot: ContextSnapshot): void {
    this.sessionId = snapshot.sessionId;
    this.taskResults = new Map(snapshot.taskResults);
    this.globalData = new Map(snapshot.globalData);
    this.workingDirectory = snapshot.workingDirectory;
    this.activeApplications = new Set(snapshot.activeApplications);
    this.recentScreenshots = [...snapshot.recentScreenshots];
  }

  /**
   * 清空上下文
   */
  clear(): void {
    this.taskResults.clear();
    this.globalData.clear();
    this.activeApplications.clear();
    this.recentScreenshots = [];
  }

  /**
   * 获取会话 ID
   */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * 搜索历史结果
   */
  searchResults(query: string): Array<{ key: string; value: any }> {
    const results: Array<{ key: string; value: any }> = [];
    const lowerQuery = query.toLowerCase();

    for (const [key, entry] of this.taskResults.entries()) {
      const searchStr = JSON.stringify(entry).toLowerCase();
      if (searchStr.includes(lowerQuery)) {
        results.push({ key, value: entry });
      }
    }

    return results;
  }

  /**
   * 导出上下文数据
   */
  export(): Record<string, any> {
    return {
      sessionId: this.sessionId,
      taskResults: Object.fromEntries(this.taskResults),
      globalData: Object.fromEntries(this.globalData),
      workingDirectory: this.workingDirectory,
      activeApplications: Array.from(this.activeApplications),
      recentScreenshots: this.recentScreenshots.length,
    };
  }

  /**
   * 导入上下文数据
   */
  import(data: Record<string, any>): void {
    this.sessionId = data.sessionId ?? uuidv4();
    this.taskResults = new Map(Object.entries(data.taskResults ?? {}));
    this.globalData = new Map(Object.entries(data.globalData ?? {}));
    this.workingDirectory = data.workingDirectory ?? process.cwd();
    this.activeApplications = new Set(data.activeApplications ?? []);
    this.recentScreenshots = data.recentScreenshots ?? [];
  }
}
