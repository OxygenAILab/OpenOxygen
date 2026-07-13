import type { ModelConfig, InferenceMode } from '../engine';

export interface ModelProfile {
  id: string;
  provider: string;
  capabilities: string[];
  contextWindow: number;
  speedTier: 'fast' | 'medium' | 'slow';
  costTier: 'low' | 'medium' | 'high';
}

export interface RouterConfig {
  defaultModel: string;
  fallbackModels: string[];
  enableAutoRouting: boolean;
}

const MODEL_REGISTRY: Record<string, ModelProfile> = {
  'gpt-4': {
    id: 'gpt-4',
    provider: 'openai',
    capabilities: ['general', 'vision', 'tool_calling', 'complex_reasoning'],
    contextWindow: 128000,
    speedTier: 'medium',
    costTier: 'high',
  },
  'gpt-4o': {
    id: 'gpt-4o',
    provider: 'openai',
    capabilities: ['general', 'vision', 'tool_calling', 'complex_reasoning', 'fast'],
    contextWindow: 128000,
    speedTier: 'fast',
    costTier: 'high',
  },
  'claude-3-5-sonnet': {
    id: 'claude-3-5-sonnet',
    provider: 'anthropic',
    capabilities: ['general', 'vision', 'tool_calling', 'long_context'],
    contextWindow: 200000,
    speedTier: 'medium',
    costTier: 'high',
  },
  'qwen3-vl:8b': {
    id: 'qwen3-vl:8b',
    provider: 'ollama',
    capabilities: ['general', 'vision'],
    contextWindow: 32768,
    speedTier: 'medium',
    costTier: 'low',
  },
  'llama3:70b': {
    id: 'llama3:70b',
    provider: 'ollama',
    capabilities: ['general', 'complex_reasoning'],
    contextWindow: 32768,
    speedTier: 'slow',
    costTier: 'low',
  },
};

const MODEL_SUCCESS_RATES: Map<string, { success: number; total: number }> = new Map();

export function selectModel(options: { mode?: InferenceMode; capabilities?: string[] }): ModelProfile | null {
  const { mode = 'balanced', capabilities = [] } = options;

  const candidates = Object.values(MODEL_REGISTRY).filter(model => {
    if (capabilities.length > 0) {
      return capabilities.every(cap => model.capabilities.includes(cap));
    }
    return true;
  });

  if (candidates.length === 0) return null;

  switch (mode) {
    case 'fast':
      return candidates.sort((a, b) => {
        const speedOrder = { fast: 0, medium: 1, slow: 2 };
        return speedOrder[a.speedTier] - speedOrder[b.speedTier];
      })[0];

    case 'deep':
      return candidates.sort((a, b) => {
        const hasComplexReasoning = (m: ModelProfile) => m.capabilities.includes('complex_reasoning');
        const hasLongContext = (m: ModelProfile) => m.capabilities.includes('long_context');
        
        let score = 0;
        if (hasComplexReasoning(a)) score += 2;
        if (hasLongContext(a)) score += 1;
        if (hasComplexReasoning(b)) score -= 2;
        if (hasLongContext(b)) score -= 1;
        
        return score;
      })[0];

    case 'balanced':
    default:
      return candidates.sort((a, b) => {
        const costOrder = { low: 0, medium: 1, high: 2 };
        const speedOrder = { fast: 0, medium: 1, slow: 2 };
        return costOrder[a.costTier] + speedOrder[a.speedTier] - (costOrder[b.costTier] + speedOrder[b.speedTier]);
      })[0];
  }
}

export function getNextApiKey(modelId: string): string | null {
  return null;
}

export function recordModelSuccess(modelId: string): void {
  const stats = MODEL_SUCCESS_RATES.get(modelId) || { success: 0, total: 0 };
  stats.success++;
  stats.total++;
  MODEL_SUCCESS_RATES.set(modelId, stats);
}

export function recordModelFailure(modelId: string): void {
  const stats = MODEL_SUCCESS_RATES.get(modelId) || { success: 0, total: 0 };
  stats.total++;
  MODEL_SUCCESS_RATES.set(modelId, stats);
}

export function getModelStats(): Record<string, { successRate: number; totalRequests: number }> {
  const result: Record<string, { successRate: number; totalRequests: number }> = {};
  
  for (const [modelId, stats] of MODEL_SUCCESS_RATES) {
    result[modelId] = {
      successRate: stats.total > 0 ? stats.success / stats.total : 0,
      totalRequests: stats.total,
    };
  }
  
  return result;
}

export function getModelProfile(modelId: string): ModelProfile | undefined {
  return MODEL_REGISTRY[modelId];
}

export function registerModel(profile: ModelProfile): void {
  MODEL_REGISTRY[profile.id] = profile;
}

export default {
  selectModel,
  getNextApiKey,
  recordModelSuccess,
  recordModelFailure,
  getModelStats,
  getModelProfile,
  registerModel,
};