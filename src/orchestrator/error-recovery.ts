/**
 * 错误分类与恢复策略
 */

export enum ErrorCategory {
  // 元素定位失败（可能坐标变了、窗口关闭、元素不存在）
  ElementNotFound = 'element_not_found',

  // 超时（操作太慢、系统卡顿、等待条件未满足）
  Timeout = 'timeout',

  // 权限不足（UAC 拦截、管理员权限、沙箱限制）
  PermissionDenied = 'permission_denied',

  // 网络问题（VLM 调用失败、Ollama 连接断开）
  NetworkError = 'network_error',

  // 配置错误（参数缺失、类型错误、无效值）
  ConfigError = 'config_error',

  // 系统资源不足（内存耗尽、磁盘满、进程崩溃）
  ResourceExhausted = 'resource_exhausted',

  // 未知错误
  Unknown = 'unknown',
}

export interface ErrorAnalysis {
  category: ErrorCategory;
  reason: string;
  canRetry: boolean;
  suggestedFix?: string;
}

/**
 * 分析错误类型
 */
export function analyzeError(error: string, stepType: string): ErrorAnalysis {
  const lowerError = error.toLowerCase();

  // 配置/参数错误（永久性，重试无意义）——必须先于元素定位判断：
  // 否则 'Target is required' / 'Cannot resolve target' 会被 'target'
  // 关键词误分类为可重试的定位失败，白白重试三次
  if (
    lowerError.includes('target is required') ||
    lowerError.includes('cannot resolve target') ||
    lowerError.includes('not available') ||
    lowerError.includes('unknown step type') ||
    lowerError.includes('not implemented') ||
    lowerError.includes('not supported')
  ) {
    return {
      category: ErrorCategory.ConfigError,
      reason: '配置或参数错误（永久性）',
      canRetry: false,
      suggestedFix: '检查步骤参数与执行环境配置',
    };
  }

  // 元素定位失败
  if (
    lowerError.includes('not found') ||
    lowerError.includes('cannot find') ||
    lowerError.includes('element not') ||
    lowerError.includes('target') ||
    lowerError.includes('cannot resolve')
  ) {
    return {
      category: ErrorCategory.ElementNotFound,
      reason: '元素定位失败',
      canRetry: true,
      suggestedFix: '重新截图定位（坐标可能变化）',
    };
  }

  // 超时
  if (
    lowerError.includes('timeout') ||
    lowerError.includes('timed out') ||
    lowerError.includes('time out')
  ) {
    return {
      category: ErrorCategory.Timeout,
      reason: '操作超时',
      canRetry: true,
      suggestedFix: '延长等待时间或增加中间步骤',
    };
  }

  // 权限问题
  if (
    lowerError.includes('permission') ||
    lowerError.includes('access denied') ||
    lowerError.includes('unauthorized') ||
    lowerError.includes('admin')
  ) {
    return {
      category: ErrorCategory.PermissionDenied,
      reason: '权限不足',
      canRetry: false,
      suggestedFix: '以管理员身份运行或检查权限设置',
    };
  }

  // 网络问题
  if (
    lowerError.includes('network') ||
    lowerError.includes('connection') ||
    lowerError.includes('econnrefused') ||
    lowerError.includes('fetch failed') ||
    lowerError.includes('ollama')
  ) {
    return {
      category: ErrorCategory.NetworkError,
      reason: '网络连接失败',
      canRetry: true,
      suggestedFix: '检查 Ollama 是否运行或网络连接',
    };
  }

  // 配置错误
  if (
    lowerError.includes('invalid') ||
    lowerError.includes('missing') ||
    lowerError.includes('required') ||
    lowerError.includes('must be')
  ) {
    return {
      category: ErrorCategory.ConfigError,
      reason: '配置或参数错误',
      canRetry: false,
      suggestedFix: '检查步骤参数是否正确',
    };
  }

  // 资源耗尽
  if (
    lowerError.includes('out of memory') ||
    lowerError.includes('oom') ||
    lowerError.includes('disk full') ||
    lowerError.includes('resource')
  ) {
    return {
      category: ErrorCategory.ResourceExhausted,
      reason: '系统资源不足',
      canRetry: false,
      suggestedFix: '释放内存或磁盘空间',
    };
  }

  // 未知错误
  return {
    category: ErrorCategory.Unknown,
    reason: '未知错误',
    canRetry: true,
    suggestedFix: '检查错误信息并手动诊断',
  };
}

/**
 * 恢复策略
 */
export interface RecoveryStrategy {
  // 是否需要重新定位目标
  shouldRelocate: boolean;

  // 超时倍数（null 表示使用原值）
  timeoutMultiplier?: number;

  // 是否需要截图验证
  shouldCaptureScreenshot: boolean;

  // 延迟时间（ms）
  delayMs: number;

  // 最大重试次数
  maxRetries: number;
}

/**
 * 根据错误类型生成恢复策略
 */
export function getRecoveryStrategy(analysis: ErrorAnalysis, attempt: number): RecoveryStrategy {
  switch (analysis.category) {
    case ErrorCategory.ElementNotFound:
      return {
        shouldRelocate: true, // 重新定位（坐标可能变了）
        timeoutMultiplier: 1.5, // 延长 50% 等待时间
        shouldCaptureScreenshot: true,
        delayMs: 1000 * attempt, // 递增延迟
        maxRetries: 3,
      };

    case ErrorCategory.Timeout:
      return {
        shouldRelocate: false,
        timeoutMultiplier: 2.0, // 翻倍等待时间
        shouldCaptureScreenshot: true,
        delayMs: 2000 * attempt,
        maxRetries: 2,
      };

    case ErrorCategory.NetworkError:
      return {
        shouldRelocate: false,
        shouldCaptureScreenshot: false,
        delayMs: 3000 * attempt, // 网络问题等更久
        maxRetries: 3,
      };

    case ErrorCategory.PermissionDenied:
    case ErrorCategory.ConfigError:
    case ErrorCategory.ResourceExhausted:
      // 这些错误重试无意义
      return {
        shouldRelocate: false,
        shouldCaptureScreenshot: true,
        delayMs: 0,
        maxRetries: 0,
      };

    case ErrorCategory.Unknown:
    default:
      return {
        shouldRelocate: false,
        timeoutMultiplier: 1.5,
        shouldCaptureScreenshot: true,
        delayMs: 1000 * attempt,
        maxRetries: 2,
      };
  }
}
