export type InferenceMode = 'fast' | 'balanced' | 'deep';

export interface ModelConfig {
  model: string;
  provider: 'openai' | 'anthropic' | 'gemini' | 'ollama' | 'openrouter' | 'stepfun';
  apiKey?: string;
  baseUrl?: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  toolCallId?: string;
  toolCalls?: ToolCallRequest[];
}

export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: string;
}

export interface InferenceRequest {
  messages: ChatMessage[];
  model?: ModelConfig;
  mode?: InferenceMode;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
  stream?: boolean;
}

export interface InferenceResponse {
  id: string;
  content: string;
  toolCalls?: ToolCallRequest[];
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  model: string;
  provider: string;
  durationMs: number;
  mode: InferenceMode;
}

export interface StreamChunk {
  id: string;
  content?: string;
  toolCall?: ToolCallRequest;
  finishReason?: 'stop' | 'length' | 'tool_calls';
}

function analyzeComplexity(messages: ChatMessage[]): InferenceMode {
  const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
  if (!lastUserMsg) return 'balanced';

  const content = lastUserMsg.content.toLowerCase();
  const length = content.length;

  const fastIndicators = [
    'hello', 'hi', 'hey',
    'what is', 'who is', 'where is',
    'simple', 'quick', 'fast',
    'yes', 'no', 'ok', 'sure',
  ];
  
  if (fastIndicators.some((i) => content.includes(i)) && length < 100) {
    return 'fast';
  }

  const deepIndicators = [
    'analyze', 'explain', 'compare',
    'evaluate', 'assess', 'review',
    'complex', 'detailed', 'comprehensive',
    'step by step', 'think through',
    'code review', 'architecture',
  ];

  if (deepIndicators.some((i) => content.includes(i)) || length > 500) {
    return 'deep';
  }

  return 'balanced';
}

interface ProviderConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

async function callOpenAICompatible(
  config: ProviderConfig,
  request: InferenceRequest
): Promise<InferenceResponse> {
  const messages = request.systemPrompt
    ? [{ role: 'system' as const, content: request.systemPrompt }, ...request.messages]
    : request.messages;

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      max_tokens: request.maxTokens ?? 2048,
      temperature: request.temperature ?? 0.7,
      stream: false,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API error: ${response.status} - ${error}`);
  }

  const data = await response.json() as {
    id?: string;
    choices: Array<{
      message: {
        content?: string;
        tool_calls?: Array<{
          id: string;
          function: { name: string; arguments: string };
        }>;
      };
    }>;
    usage?: {
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
    };
    model?: string;
  };
  const choice = data.choices[0];

  return {
    id: data.id || `resp_${Date.now()}`,
    content: choice.message.content || '',
    toolCalls: choice.message.tool_calls?.map((t) => ({
      id: t.id,
      name: t.function.name,
      arguments: t.function.arguments,
    })),
    usage: data.usage ? {
      promptTokens: data.usage.prompt_tokens,
      completionTokens: data.usage.completion_tokens,
      totalTokens: data.usage.total_tokens,
    } : undefined,
    model: data.model || config.model,
    provider: 'openai',
    durationMs: 0,
    mode: request.mode || 'balanced',
  };
}

async function callAnthropic(
  config: ProviderConfig,
  request: InferenceRequest
): Promise<InferenceResponse> {
  const systemPrompt = request.systemPrompt || 
    request.messages.find((m) => m.role === 'system')?.content;
  
  const messages = request.messages.filter((m) => m.role !== 'system');

  const response = await fetch(`${config.baseUrl}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: config.model,
      messages: messages.map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      })),
      system: systemPrompt,
      max_tokens: request.maxTokens ?? 2048,
      temperature: request.temperature ?? 0.7,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API error: ${response.status} - ${error}`);
  }

  const data = await response.json() as {
    id?: string;
    content: Array<{ text?: string }>;
    usage?: {
      input_tokens: number;
      output_tokens: number;
    };
    model?: string;
  };
  
  return {
    id: data.id || `resp_${Date.now()}`,
    content: data.content[0]?.text || '',
    usage: data.usage ? {
      promptTokens: data.usage.input_tokens,
      completionTokens: data.usage.output_tokens,
      totalTokens: data.usage.input_tokens + data.usage.output_tokens,
    } : undefined,
    model: data.model || config.model,
    provider: 'anthropic',
    durationMs: 0,
    mode: request.mode || 'balanced',
  };
}

async function callGemini(
  config: ProviderConfig,
  request: InferenceRequest
): Promise<InferenceResponse> {
  const contents = request.messages.map((m) => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: m.content }],
  }));

  const response = await fetch(
    `${config.baseUrl}/models/${config.model}:generateContent?key=${config.apiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents,
        generationConfig: {
          maxOutputTokens: request.maxTokens ?? 2048,
          temperature: request.temperature ?? 0.7,
        },
      }),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API error: ${response.status} - ${error}`);
  }

  const data = await response.json() as {
    candidates: Array<{
      content: {
        parts: Array<{ text?: string }>;
      };
    }>;
  };
  const candidate = data.candidates[0];

  return {
    id: `resp_${Date.now()}`,
    content: candidate.content.parts[0]?.text || '',
    model: config.model,
    provider: 'gemini',
    durationMs: 0,
    mode: request.mode || 'balanced',
  };
}

async function callOllama(
  config: ProviderConfig,
  request: InferenceRequest
): Promise<InferenceResponse> {
  const messages = request.systemPrompt
    ? [{ role: 'system' as const, content: request.systemPrompt }, ...request.messages]
    : request.messages;

  const response = await fetch(`${config.baseUrl}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      stream: false,
      options: {
        temperature: request.temperature ?? 0.7,
        num_predict: request.maxTokens ?? 2048,
      },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API error: ${response.status} - ${error}`);
  }

  const data = await response.json() as {
    message?: {
      content?: string;
    };
  };
  
  return {
    id: `resp_${Date.now()}`,
    content: data.message?.content || '',
    model: config.model,
    provider: 'ollama',
    durationMs: 0,
    mode: request.mode || 'balanced',
  };
}

function getDefaultBaseUrl(provider: string): string {
  switch (provider) {
    case 'openai':
      return 'https://api.openai.com/v1';
    case 'anthropic':
      return 'https://api.anthropic.com/v1';
    case 'gemini':
      return 'https://generativelanguage.googleapis.com/v1beta';
    case 'openrouter':
      return 'https://openrouter.ai/api/v1';
    case 'stepfun':
      return 'https://api.stepfun.com/v1';
    case 'ollama':
      return 'http://localhost:11434';
    default:
      return '';
  }
}

export async function runInference(
  request: InferenceRequest
): Promise<InferenceResponse> {
  const startTime = Date.now();

  const mode = request.mode || analyzeComplexity(request.messages);

  const modelProfile = request.model 
    ? { id: request.model.model, provider: request.model.provider }
    : { id: 'gpt-4', provider: 'openai' as const };

  const apiKey = request.model?.apiKey || '';

  const config: ProviderConfig = {
    baseUrl: request.model?.baseUrl || getDefaultBaseUrl(modelProfile.provider),
    apiKey: apiKey || '',
    model: request.model?.model || modelProfile.id,
  };

  let response: InferenceResponse;
  switch (modelProfile.provider) {
    case 'openai':
    case 'openrouter':
    case 'stepfun':
      response = await callOpenAICompatible(config, request);
      break;
    case 'anthropic':
      response = await callAnthropic(config, request);
      break;
    case 'gemini':
      response = await callGemini(config, request);
      break;
    case 'ollama':
      response = await callOllama(config, request);
      break;
    default:
      throw new Error(`Unsupported provider: ${modelProfile.provider}`);
  }

  response.durationMs = Date.now() - startTime;
  response.mode = mode;

  return response;
}

export async function* streamInference(
  request: InferenceRequest
): AsyncGenerator<StreamChunk> {
  const response = await runInference({ ...request, stream: true });

  yield {
    id: response.id,
    content: response.content,
    finishReason: 'stop',
  };
}

export async function chat(
  messages: ChatMessage[],
  options: Omit<InferenceRequest, 'messages'> = {}
): Promise<string> {
  const response = await runInference({ messages, ...options });
  return response.content;
}