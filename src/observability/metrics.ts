/**
 * Metrics 收集器
 *
 * 收集运行时指标：成功率、延迟分布、token 消耗、定位器命中率
 */

export interface LatencyBucket {
  count: number;
  totalMs: number;
  min: number;
  max: number;
  samples: number[];
}

export interface Metrics {
  // 任务级指标
  tasks: {
    total: number;
    success: number;
    failure: number;
    successRate: number;
  };

  // 步骤级指标
  steps: {
    total: number;
    success: number;
    failure: number;
    successRate: number;
    byType: Record<string, { total: number; success: number; failure: number }>;
  };

  // 延迟分布
  latency: {
    task: LatencyBucket;
    plan: LatencyBucket;
    stepByType: Record<string, LatencyBucket>;
  };

  // Token 消耗（LLM 调用）
  tokens: {
    totalPrompt: number;
    totalCompletion: number;
    total: number;
    byProvider: Record<string, { prompt: number; completion: number; total: number }>;
  };

  // 定位器命中率
  locator: {
    uia: { total: number; hit: number; miss: number; hitRate: number };
    vlm: { total: number; hit: number; miss: number; hitRate: number };
  };

  // 错误恢复
  errorRecovery: {
    totalRetries: number;
    successfulRetries: number;
    failedRetries: number;
    byCategory: Record<string, { retries: number; success: number; failure: number }>;
  };
}

export class MetricsCollector {
  private metrics: Metrics;

  constructor() {
    this.metrics = this.createEmptyMetrics();
  }

  private createEmptyMetrics(): Metrics {
    return {
      tasks: { total: 0, success: 0, failure: 0, successRate: 0 },
      steps: { total: 0, success: 0, failure: 0, successRate: 0, byType: {} },
      latency: {
        task: this.createEmptyBucket(),
        plan: this.createEmptyBucket(),
        stepByType: {},
      },
      tokens: { totalPrompt: 0, totalCompletion: 0, total: 0, byProvider: {} },
      locator: {
        uia: { total: 0, hit: 0, miss: 0, hitRate: 0 },
        vlm: { total: 0, hit: 0, miss: 0, hitRate: 0 },
      },
      errorRecovery: {
        totalRetries: 0,
        successfulRetries: 0,
        failedRetries: 0,
        byCategory: {},
      },
    };
  }

  private createEmptyBucket(): LatencyBucket {
    return {
      count: 0,
      totalMs: 0,
      min: Infinity,
      max: 0,
      samples: [],
    };
  }

  /**
   * 记录任务完成
   */
  recordTask(success: boolean, durationMs: number): void {
    this.metrics.tasks.total++;
    if (success) {
      this.metrics.tasks.success++;
    } else {
      this.metrics.tasks.failure++;
    }
    this.metrics.tasks.successRate =
      this.metrics.tasks.total > 0 ? this.metrics.tasks.success / this.metrics.tasks.total : 0;

    this.addLatencySample(this.metrics.latency.task, durationMs);
  }

  /**
   * 记录计划生成
   */
  recordPlan(success: boolean, durationMs: number): void {
    this.addLatencySample(this.metrics.latency.plan, durationMs);
  }

  /**
   * 记录步骤完成
   */
  recordStep(type: string, success: boolean, durationMs: number): void {
    this.metrics.steps.total++;
    if (success) {
      this.metrics.steps.success++;
    } else {
      this.metrics.steps.failure++;
    }
    this.metrics.steps.successRate =
      this.metrics.steps.total > 0 ? this.metrics.steps.success / this.metrics.steps.total : 0;

    // 按类型统计
    if (!this.metrics.steps.byType[type]) {
      this.metrics.steps.byType[type] = { total: 0, success: 0, failure: 0 };
    }
    const byType = this.metrics.steps.byType[type];
    byType.total++;
    if (success) {
      byType.success++;
    } else {
      byType.failure++;
    }

    // 延迟统计
    if (!this.metrics.latency.stepByType[type]) {
      this.metrics.latency.stepByType[type] = this.createEmptyBucket();
    }
    this.addLatencySample(this.metrics.latency.stepByType[type], durationMs);
  }

  /**
   * 记录 token 消耗
   */
  recordTokens(provider: string, promptTokens: number, completionTokens: number): void {
    this.metrics.tokens.totalPrompt += promptTokens;
    this.metrics.tokens.totalCompletion += completionTokens;
    this.metrics.tokens.total += promptTokens + completionTokens;

    if (!this.metrics.tokens.byProvider[provider]) {
      this.metrics.tokens.byProvider[provider] = { prompt: 0, completion: 0, total: 0 };
    }
    const byProvider = this.metrics.tokens.byProvider[provider];
    byProvider.prompt += promptTokens;
    byProvider.completion += completionTokens;
    byProvider.total += promptTokens + completionTokens;
  }

  /**
   * 记录定位器使用
   */
  recordLocator(level: 'uia' | 'vlm', hit: boolean): void {
    const locator = this.metrics.locator[level];
    locator.total++;
    if (hit) {
      locator.hit++;
    } else {
      locator.miss++;
    }
    locator.hitRate = locator.total > 0 ? locator.hit / locator.total : 0;
  }

  /**
   * 记录重试
   */
  recordRetry(category: string, success: boolean): void {
    this.metrics.errorRecovery.totalRetries++;
    if (success) {
      this.metrics.errorRecovery.successfulRetries++;
    } else {
      this.metrics.errorRecovery.failedRetries++;
    }

    if (!this.metrics.errorRecovery.byCategory[category]) {
      this.metrics.errorRecovery.byCategory[category] = { retries: 0, success: 0, failure: 0 };
    }
    const byCategory = this.metrics.errorRecovery.byCategory[category];
    byCategory.retries++;
    if (success) {
      byCategory.success++;
    } else {
      byCategory.failure++;
    }
  }

  /**
   * 添加延迟样本
   */
  private addLatencySample(bucket: LatencyBucket, durationMs: number): void {
    bucket.count++;
    bucket.totalMs += durationMs;
    bucket.min = Math.min(bucket.min, durationMs);
    bucket.max = Math.max(bucket.max, durationMs);
    bucket.samples.push(durationMs);
  }

  /**
   * 计算百分位数（P50/P95/P99）
   */
  private calculatePercentile(bucket: LatencyBucket, percentile: number): number {
    if (bucket.samples.length === 0) return 0;

    const sorted = [...bucket.samples].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  /**
   * 获取当前指标快照
   */
  snapshot(): Metrics {
    return JSON.parse(JSON.stringify(this.metrics));
  }

  /**
   * 生成人类可读的报告
   */
  report(): string {
    const lines: string[] = [];

    lines.push('════════════════════════════════════════');
    lines.push('         OpenOxygen 运行指标');
    lines.push('════════════════════════════════════════');
    lines.push('');

    // 任务级指标
    lines.push('任务级指标');
    lines.push('────────────────────────────────────────');
    lines.push(`  总数: ${this.metrics.tasks.total}`);
    lines.push(`  成功: ${this.metrics.tasks.success}`);
    lines.push(`  失败: ${this.metrics.tasks.failure}`);
    lines.push(`  成功率: ${(this.metrics.tasks.successRate * 100).toFixed(1)}%`);
    if (this.metrics.latency.task.count > 0) {
      lines.push(`  延迟: P50=${this.calculatePercentile(this.metrics.latency.task, 50).toFixed(0)}ms, P95=${this.calculatePercentile(this.metrics.latency.task, 95).toFixed(0)}ms, P99=${this.calculatePercentile(this.metrics.latency.task, 99).toFixed(0)}ms`);
    }
    lines.push('');

    // 步骤级指标
    lines.push('步骤级指标');
    lines.push('────────────────────────────────────────');
    lines.push(`  总数: ${this.metrics.steps.total}`);
    lines.push(`  成功: ${this.metrics.steps.success}`);
    lines.push(`  失败: ${this.metrics.steps.failure}`);
    lines.push(`  成功率: ${(this.metrics.steps.successRate * 100).toFixed(1)}%`);
    lines.push('');
    lines.push('  按类型:');
    for (const [type, stats] of Object.entries(this.metrics.steps.byType)) {
      const rate = stats.total > 0 ? (stats.success / stats.total * 100).toFixed(1) : '0.0';
      const bucket = this.metrics.latency.stepByType[type];
      const p50 = bucket ? this.calculatePercentile(bucket, 50).toFixed(0) : '0';
      lines.push(`    ${type}: ${stats.success}/${stats.total} (${rate}%), P50=${p50}ms`);
    }
    lines.push('');

    // Token 消耗
    if (this.metrics.tokens.total > 0) {
      lines.push('Token 消耗');
      lines.push('────────────────────────────────────────');
      lines.push(`  总计: ${this.metrics.tokens.total.toLocaleString()}`);
      lines.push(`  Prompt: ${this.metrics.tokens.totalPrompt.toLocaleString()}`);
      lines.push(`  Completion: ${this.metrics.tokens.totalCompletion.toLocaleString()}`);
      lines.push('');
      lines.push('  按 Provider:');
      for (const [provider, tokens] of Object.entries(this.metrics.tokens.byProvider)) {
        lines.push(`    ${provider}: ${tokens.total.toLocaleString()} (P:${tokens.prompt.toLocaleString()} + C:${tokens.completion.toLocaleString()})`);
      }
      lines.push('');
    }

    // 定位器命中率
    if (this.metrics.locator.uia.total > 0 || this.metrics.locator.vlm.total > 0) {
      lines.push('定位器命中率');
      lines.push('────────────────────────────────────────');
      if (this.metrics.locator.uia.total > 0) {
        lines.push(`  UIA: ${this.metrics.locator.uia.hit}/${this.metrics.locator.uia.total} (${(this.metrics.locator.uia.hitRate * 100).toFixed(1)}%)`);
      }
      if (this.metrics.locator.vlm.total > 0) {
        lines.push(`  VLM: ${this.metrics.locator.vlm.hit}/${this.metrics.locator.vlm.total} (${(this.metrics.locator.vlm.hitRate * 100).toFixed(1)}%)`);
      }
      lines.push('');
    }

    // 错误恢复
    if (this.metrics.errorRecovery.totalRetries > 0) {
      lines.push('错误恢复');
      lines.push('────────────────────────────────────────');
      lines.push(`  重试总数: ${this.metrics.errorRecovery.totalRetries}`);
      lines.push(`  成功: ${this.metrics.errorRecovery.successfulRetries}`);
      lines.push(`  失败: ${this.metrics.errorRecovery.failedRetries}`);
      lines.push('');
      lines.push('  按类别:');
      for (const [category, stats] of Object.entries(this.metrics.errorRecovery.byCategory)) {
        const rate = stats.retries > 0 ? (stats.success / stats.retries * 100).toFixed(1) : '0.0';
        lines.push(`    ${category}: ${stats.success}/${stats.retries} (${rate}%)`);
      }
      lines.push('');
    }

    lines.push('════════════════════════════════════════');

    return lines.join('\n');
  }

  /**
   * 重置所有指标
   */
  reset(): void {
    this.metrics = this.createEmptyMetrics();
  }
}

/**
 * 全局单例
 */
export const metrics = new MetricsCollector();
