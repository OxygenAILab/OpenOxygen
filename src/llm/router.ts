/**
 * LLM Router - 动态模型路由
 * 
 * 根据任务复杂度、可用模型、成本等因素选择最佳 LLM
 */

import { EventEmitter } from 'events';

export interface RouterConfig {
  ollamaUrl: string;
  openaiKey?: string;
  anthropicKey?: string;
  preferLocal: boolean;
  costOptimization: boolean;
}

export enum TaskComplexity {
  Simple = 'simple',      // 简单问答、文本生成
  Medium = 'medium',      // 任务规划、代码生成
  Complex = 'complex',    // 多步推理、复杂分析
  Vision = 'vision',        // 视觉理解
}

export interface ModelInfo {
  provider: 'ollama' | 'openai' | 'anthropic';
  model: string;
  tier: 'weak' | 'medium' | 'strong';
  capabilities: string[];
  costPer1K: number;
  latencyMs: number;
  contextWindow: number;
}

export class LLMRouter extends EventEmitter {
  private config: RouterConfig;
  private availableModels: ModelInfo[] = [];

  constructor(config: RouterConfig) {
    super();
    this.config = config;
    this.refreshModelList();
  }

  /** 刷新可用模型列表 */
  async refreshModelList(): Promise<void> {
    this.availableModels = [];
    
    // Ollama 本地模型
    try {
      const res = await fetch(`${this.config.ollamaUrl}/api/tags`);
      const data = await res.json();
      
      for (const m of data.models) {
        this.availableModels.push({
          provider: 'ollama',
          model: m.name,
          tier: this.inferTier(m.name),
          capabilities: this.inferCapabilities(m.name),
          costPer1K: 0,
          latencyMs: 500,
          contextWindow: 32768,
        });
      }
    } catch (e) {
      console.warn('Ollama not available:', e);
    }
    
    // 云服务模型
    if (this.config.openaiKey) {
      this.availableModels.push(
        { provider: 'openai', model: 'gpt-4o-mini', tier: 'weak', capabilities: ['text', 'code'], costPer1K: 0.00015, latencyMs: 300, contextWindow: 128000 },
        { provider: 'openai', model: 'gpt-4o', tier: 'strong', capabilities: ['text', 'vision', 'code'], costPer1K: 0.005, latencyMs: 800, contextWindow: 128000 }
      );
    }
    
    if (this.config.anthropicKey) {
      this.availableModels.push(
        { provider: 'anthropic', model: 'claude-3-haiku', tier: 'weak', capabilities: ['text', 'code'], costPer1K: 0.00025, latencyMs: 400, contextWindow: 200000 },
        { provider: 'anthropic', model: 'claude-3-sonnet', tier: 'medium', capabilities: ['text', 'vision', 'code'], costPer1K: 0.003, latencyMs: 1000, contextWindow: 200000 },
        { provider: 'anthropic', model: 'claude-3-opus', tier: 'strong', capabilities: ['text', 'vision', 'code'], costPer1K: 0.015, latencyMs: 2000, contextWindow: 200000 }
      );
    }
    
    this.emit('modelsUpdated', this.availableModels);
  }

  /** 路由请求到合适的模型 */
  async route(
    prompt: string,
    complexity: TaskComplexity,
    requireVision: boolean = false
  ): Promise<ModelInfo> {
    const candidates = this.availableModels.filter(m => {
      if (requireVision && !m.capabilities.includes('vision')) {
        return false;
      }
      
      // 根据复杂度过滤
      if (complexity === TaskComplexity.Simple) {
        return m.tier === 'weak';
      } else if (complexity === TaskComplexity.Complex || complexity === TaskComplexity.Vision) {
        return m.tier === 'strong';
      }
      return true;
    });
    
    if (candidates.length === 0) {
      // 降级选择
      return this.fallbackRoute(complexity, requireVision);
    }
    
    // 偏好本地模型
    if (this.config.preferLocal) {
      const local = candidates.find(c => c.provider === 'ollama');
      if (local) return local;
    }
    
    // 成本优化
    if (this.config.costOptimization) {
      return candidates.sort((a, b) => a.costPer1K - b.costPer1K)[0];
    }
    
    // 延迟优化（选择最快的）
    return candidates.sort((a, b) => a.latencyMs - b.latencyMs)[0];
  }

  /** 四级决策分支路由 */
  async routeByDecisionBranch(
    decision: 'simple_no_agent' | 'simple_with_agent' | 'complex_no_agent' | 'complex_with_agent',
    visionRequired: boolean
  ): Promise<ModelInfo[]> {
    const routes: ModelInfo[] = [];
    
    switch (decision) {
      case 'simple_no_agent':
        // 弱 LLM 直接推理
        routes.push(...this.availableModels.filter(m => m.tier === 'weak'));
        break;
      case 'simple_with_agent':
        // 中/弱 LLM + HTN
        routes.push(...this.availableModels.filter(m => m.tier === 'medium' || m.tier === 'weak'));
        break;
      case 'complex_no_agent':
        // 强 LLM CoT 推理
        routes.push(...this.availableModels.filter(m => m.tier === 'strong'));
        break;
      case 'complex_with_agent':
        // 强 LLM + HTN
        routes.push(...this.availableModels.filter(m => m.tier === 'strong'));
        break;
    }
    
    if (visionRequired) {
      return routes.filter(m => m.capabilities.includes('vision'));
    }
    
    return routes;
  }

  /** 降级路由 */
  private fallbackRoute(
    complexity: TaskComplexity,
    requireVision: boolean
  ): ModelInfo {
    // 选择最强可用模型
    const sorted = this.availableModels
      .filter(m => !requireVision || m.capabilities.includes('vision'))
      .sort((a, b) => {
        const tierOrder = { strong: 3, medium: 2, weak: 1 };
        return tierOrder[b.tier] - tierOrder[a.tier];
      });
    
    if (sorted.length === 0) {
      throw new Error('No LLM available');
    }
    
    return sorted[0];
  }

  private inferTier(modelName: string): 'weak' | 'medium' | 'strong' {
    const lower = modelName.toLowerCase();
    if (lower.includes('70b') || lower.includes('405b') || lower.includes('mixtral')) {
      return 'strong';
    }
    if (lower.includes('13b') || lower.includes('30b')) {
      return 'medium';
    }
    return 'weak';
  }

  private inferCapabilities(modelName: string): string[] {
    const caps: string[] = ['text'];
    const lower = modelName.toLowerCase();
    
    if (lower.includes('vision') || lower.includes('llava')) {
      caps.push('vision');
    }
    if (lower.includes('code')) {
      caps.push('code');
    }
    
    return caps;
  }
}
