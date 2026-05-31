/**
 * Ollama 模型管理器
 * 
 * 集成 Ollama 本地 LLM 服务
 * 模型列表管理、动态加载
 */

import { EventEmitter } from 'events';

export interface OllamaConfig {
  baseUrl: string;
  defaultTimeoutMs: number;
  autoPullMissing: boolean;
}

export interface OllamaModel {
  name: string;
  size: number;
  parameterSize: string;
  quantizationLevel: string;
  family: string;
  capabilities: string[];
}

export class OllamaManager extends EventEmitter {
  private config: OllamaConfig;
  private modelCache: Map<string, OllamaModel> = new Map();

  constructor(config: Partial<OllamaConfig> = {}) {
    super();
    this.config = {
      baseUrl: 'http://localhost:11434',
      defaultTimeoutMs: 60000,
      autoPullMissing: false,
      ...config,
    };
  }

  /** 获取本地模型列表 */
  async listModels(): Promise<OllamaModel[]> {
    const response = await fetch(`${this.config.baseUrl}/api/tags`);
    const data = await response.json();
    const models: OllamaModel[] = data.models.map((m: any) => ({
      name: m.name,
      size: m.size,
      parameterSize: m.details?.parameter_size || 'unknown',
      quantizationLevel: m.details?.quantization_level || 'unknown',
      family: m.details?.family || 'unknown',
      capabilities: this.inferCapabilities(m.name),
    }));
    
    // 更新缓存
    this.modelCache.clear();
    models.forEach(m => this.modelCache.set(m.name, m));
    
    this.emit('modelsUpdated', models);
    return models;
  }

  /** 检查模型是否存在 */
  hasModel(name: string): boolean {
    return this.modelCache.has(name);
  }

  /** 拉取新模型 */
  async pullModel(name: string): Promise<void> {
    this.emit('pullStarted', name);
    
    const response = await fetch(`${this.config.baseUrl}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, stream: false }),
    });
    
    if (!response.ok) {
      throw new Error(`Failed to pull model ${name}`);
    }
    
    this.emit('pullCompleted', name);
    await this.listModels(); // 刷新列表
  }

  /** 生成文本 */
  async generate(
    model: string,
    prompt: string,
    options: any = {}
  ): Promise<{ response: string; total_duration: number }> {
    const response = await fetch(`${this.config.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        ...options,
      }),
    });
    
    return await response.json();
  }

  /** 推断模型能力 */
  private inferCapabilities(modelName: string): string[] {
    const caps: string[] = ['text'];
    
    if (modelName.includes('vision') || modelName.includes('vl')) {
      caps.push('vision');
    }
    if (modelName.includes('code')) {
      caps.push('code');
    }
    if (modelName.includes('embed')) {
      caps.push('embedding');
    }
    
    return caps;
  }

  /** 按能力选择最佳模型 */
  selectModelForCapability(
    requiredCapability: string,
    size: 'small' | 'medium' | 'large' = 'medium'
  ): OllamaModel | undefined {
    const candidates = Array.from(this.modelCache.values())
      .filter(m => m.capabilities.includes(requiredCapability));
    
    // 根据大小偏好选择
    return candidates.sort((a, b) => {
      const sizeA = this.parseSize(a.parameterSize);
      const sizeB = this.parseSize(b.parameterSize);
      
      if (size === 'small') return sizeA - sizeB;
      if (size === 'large') return sizeB - sizeA;
      return Math.abs(sizeA - 7) - Math.abs(sizeB - 7); // 中等偏好
    })[0];
  }

  private parseSize(sizeStr: string): number {
    const match = sizeStr.match(/(\d+)b/i);
    return match ? parseInt(match[1]) : 7;
  }
}
