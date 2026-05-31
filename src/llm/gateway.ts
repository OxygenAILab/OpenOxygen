/**
 * LLM 网关
 * 
 * 统一 LLM 接口，支持多模型和工具调用
 */

import { EventEmitter } from 'events';

export interface LLMConfig {
  provider: 'openai' | 'anthropic' | 'local' | 'custom';
  apiKey: string;
  baseUrl?: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  timeout?: number;
}

export interface CompletionRequest {
  system?: string;
  prompt: string;
  messages?: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  format?: 'text' | 'json';
  tools?: ToolDefinition[];
}

export interface CompletionResponse {
  content: string;
  toolCalls?: ToolCall[];
  usage: TokenUsage;
  model: string;
  finishReason: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface VisionRequest {
  prompt: string;
  images: string[]; // base64 encoded
  system?: string;
}

/**
 * LLM 网关
 */
export class LLMGateway extends EventEmitter {
  private config: LLMConfig;
  private requestCount = 0;
  private errorCount = 0;

  constructor(config: LLMConfig) {
    super();
    this.config = {
      temperature: 0.7,
      maxTokens: 2000,
      timeout: 60000,
      ...config,
    };
  }

  /**
   * 获取文本补全
   */
  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    this.requestCount++;
    
    const messages: ChatMessage[] = [];
    
    if (request.system) {
      messages.push({ role: 'system', content: request.system });
    }
    
    if (request.messages) {
      messages.push(...request.messages);
    } else {
      messages.push({ role: 'user', content: request.prompt });
    }

    try {
      const response = await this.callProvider({
        messages,
        temperature: request.temperature ?? this.config.temperature,
        maxTokens: request.maxTokens ?? this.config.maxTokens,
        tools: request.tools,
        responseFormat: request.format === 'json' ? { type: 'json_object' } : undefined,
      });

      this.emit('completion', {
        model: this.config.model,
        usage: response.usage,
        success: true,
      });

      return response;
    } catch (error) {
      this.errorCount++;
      this.emit('error', { error, model: this.config.model });
      throw error;
    }
  }

  /**
   * 带工具调用的补全
   */
  async completeWithTools(
    request: CompletionRequest
  ): Promise<CompletionResponse> {
    return this.complete(request);
  }

  /**
   * 视觉理解
   */
  async vision(request: VisionRequest): Promise<CompletionResponse> {
    const messages: ChatMessage[] = [];
    
    if (request.system) {
      messages.push({ role: 'system', content: request.system });
    }

    // 构建多模态消息
    const content: any[] = [{ type: 'text', text: request.prompt }];
    
    for (const image of request.images) {
      content.push({
        type: 'image_url',
        image_url: {
          url: image.startsWith('data:') ? image : `data:image/png;base64,${image}`,
        },
      });
    }

    messages.push({ role: 'user', content: JSON.stringify(content) });

    return this.callProvider({
      messages,
      temperature: this.config.temperature,
      maxTokens: this.config.maxTokens,
    });
  }

  /**
   * 流式补全
   */
  async *stream(request: CompletionRequest): AsyncGenerator<string> {
    const messages: ChatMessage[] = [];
    
    if (request.system) {
      messages.push({ role: 'system', content: request.system });
    }
    
    messages.push({ role: 'user', content: request.prompt });

    yield* this.callProviderStream({
      messages,
      temperature: request.temperature ?? this.config.temperature,
      maxTokens: request.maxTokens ?? this.config.maxTokens,
    });
  }

  /**
   * 调用提供商 API
   */
  private async callProvider(params: any): Promise<CompletionResponse> {
    switch (this.config.provider) {
      case 'openai':
        return this.callOpenAI(params);
      case 'anthropic':
        return this.callAnthropic(params);
      case 'local':
        return this.callLocal(params);
      default:
        throw new Error(`Unknown provider: ${this.config.provider}`);
    }
  }

  /**
   * 调用 OpenAI API
   */
  private async callOpenAI(params: any): Promise<CompletionResponse> {
    const url = `${this.config.baseUrl || 'https://api.openai.com/v1'}/chat/completions`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        messages: params.messages,
        temperature: params.temperature,
        max_tokens: params.maxTokens,
        tools: params.tools,
        response_format: params.responseFormat,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${error}`);
    }

    const data = await response.json();
    const choice = data.choices[0];

    return {
      content: choice.message.content || '',
      toolCalls: choice.message.tool_calls?.map((call: any) => ({
        id: call.id,
        name: call.function.name,
        arguments: JSON.parse(call.function.arguments),
      })),
      usage: {
        promptTokens: data.usage?.prompt_tokens || 0,
        completionTokens: data.usage?.completion_tokens || 0,
        totalTokens: data.usage?.total_tokens || 0,
      },
      model: data.model,
      finishReason: choice.finish_reason,
    };
  }

  /**
   * 调用 Anthropic API
   */
  private async callAnthropic(params: any): Promise<CompletionResponse> {
    const url = `${this.config.baseUrl || 'https://api.anthropic.com'}/v1/messages`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.config.model,
        messages: params.messages.filter((m: ChatMessage) => m.role !== 'system'),
        system: params.messages.find((m: ChatMessage) => m.role === 'system')?.content,
        temperature: params.temperature,
        max_tokens: params.maxTokens,
        tools: params.tools,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic API error: ${error}`);
    }

    const data = await response.json();
    
    return {
      content: data.content.find((c: any) => c.type === 'text')?.text || '',
      toolCalls: data.content
        .filter((c: any) => c.type === 'tool_use')
        .map((c: any) => ({
          id: c.id,
          name: c.name,
          arguments: c.input,
        })),
      usage: {
        promptTokens: data.usage?.input_tokens || 0,
        completionTokens: data.usage?.output_tokens || 0,
        totalTokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
      },
      model: data.model,
      finishReason: data.stop_reason,
    };
  }

  /**
   * 调用本地模型
   */
  private async callLocal(params: any): Promise<CompletionResponse> {
    // 连接到本地模型服务（如 Ollama、LM Studio）
    const url = `${this.config.baseUrl || 'http://localhost:11434'}/api/chat`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.config.model,
        messages: params.messages,
        stream: false,
        options: {
          temperature: params.temperature,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Local API error: ${response.statusText}`);
    }

    const data = await response.json();
    
    return {
      content: data.message?.content || '',
      usage: {
        promptTokens: data.prompt_eval_count || 0,
        completionTokens: data.eval_count || 0,
        totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
      },
      model: data.model,
      finishReason: data.done ? 'stop' : 'length',
    };
  }

  /**
   * 流式调用
   */
  private async *callProviderStream(params: any): AsyncGenerator<string> {
    const url = `${this.config.baseUrl || 'https://api.openai.com/v1'}/chat/completions`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        messages: params.messages,
        temperature: params.temperature,
        max_tokens: params.maxTokens,
        stream: true,
      }),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.statusText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;
          
          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) yield content;
          } catch {
            // Ignore parse errors
          }
        }
      }
    }
  }

  /**
   * 获取统计信息
   */
  getStats(): { requests: number; errors: number; errorRate: number } {
    return {
      requests: this.requestCount,
      errors: this.errorCount,
      errorRate: this.requestCount > 0 ? this.errorCount / this.requestCount : 0,
    };
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<LLMConfig>): void {
    this.config = { ...this.config, ...config };
  }
}
