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
  /** 图片（裸 base64 或 data URI），供视觉模型使用。目前仅 Ollama 后端消费。 */
  images?: string[];
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
  const messages = buildOpenAIMessages(request.messages, request.systemPrompt);

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
  
  const messages = buildAnthropicMessages(
    request.messages.filter((m) => m.role !== 'system')
  );

  const response = await fetch(`${config.baseUrl}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: config.model,
      messages,
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
  const contents = buildGeminiContents(request.messages);

  const response = await fetch(
    `${config.baseUrl}/models/${config.model}:generateContent?key=${config.apiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents,
        ...(request.systemPrompt
          ? { systemInstruction: { parts: [{ text: request.systemPrompt }] } }
          : {}),
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

/**
 * 剥离 data URI 前缀，返回裸 base64。
 * Ollama 的 /api/chat 要求 images 数组里是裸 base64，不能带 `data:image/png;base64,` 前缀。
 */
export function stripDataUriPrefix(image: string): string {
  const match = image.match(/^data:[^;]+;base64,(.*)$/s);
  return match ? match[1] : image;
}

interface OllamaChatMessage {
  role: string;
  content: string;
  images?: string[];
}

/**
 * 把通用 ChatMessage 转换为 Ollama /api/chat 期望的消息格式。
 * 关键点：图片必须放进 messages[].images（裸 base64），而不是塞进 content 文本。
 */
export function buildOllamaMessages(
  messages: ChatMessage[],
  systemPrompt?: string
): OllamaChatMessage[] {
  const mapped = messages.map((m) => {
    const msg: OllamaChatMessage = { role: m.role, content: m.content };
    if (m.images && m.images.length > 0) {
      msg.images = m.images.map(stripDataUriPrefix);
    }
    return msg;
  });

  return systemPrompt
    ? [{ role: 'system', content: systemPrompt }, ...mapped]
    : mapped;
}

/**
 * 确保 图片 是 data URI 格式（OpenAI 多模态 content 要求）。
 * 裸 base64 默认按 PNG 处理（robotjs 截图场景）。
 */
export function ensureDataUriPrefix(image: string): string {
  if (/^data:[^;]+;base64,/.test(image)) return image;
  return `data:image/png;base64,${image}`;
}

type OpenAIContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

interface OpenAIMessage {
  role: string;
  content: string | OpenAIContentPart[];
}

/** 按图片头部魔数判断 MIME 类型，未知时默认按 PNG 处理。 */
export function detectImageMime(base64: string): string {
  try {
    const head = Buffer.from(base64.slice(0, 32), 'base64');
    if (head.length >= 4 && head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) {
      return 'image/png';
    }
    if (head.length >= 2 && head[0] === 0xff && head[1] === 0xd8) {
      return 'image/jpeg';
    }
    if (head.length >= 3 && head.toString('ascii', 0, 3) === 'GIF') {
      return 'image/gif';
    }
    if (
      head.length >= 12 &&
      head.toString('ascii', 0, 4) === 'RIFF' &&
      head.toString('ascii', 8, 12) === 'WEBP'
    ) {
      return 'image/webp';
    }
  } catch {
    // 非法 base64 时走默认值
  }
  return 'image/png';
}

/** Anthropic 多模态 content 块 */
type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | {
      type: 'image';
      source: { type: 'base64'; media_type: string; data: string };
    };

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

/**
 * 把通用 ChatMessage 转换为 Anthropic /messages 的消息格式。
 * 关键点：有图时 content 必须是内容块数组（text + image.source.base64），
 * 且 source.data 要求裸 base64（不带 data URI 前缀）。
 */
export function buildAnthropicMessages(messages: ChatMessage[]): AnthropicMessage[] {
  return messages.map((m) => {
    if (m.images && m.images.length > 0) {
      const blocks: AnthropicContentBlock[] = [];
      if (m.content) {
        blocks.push({ type: 'text', text: m.content });
      }
      for (const img of m.images) {
        blocks.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: detectImageMime(img),
            data: stripDataUriPrefix(img),
          },
        });
      }
      return { role: m.role === 'assistant' ? 'assistant' : 'user', content: blocks };
    }
    return {
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    };
  });
}

/** Gemini 多模态 part（v1beta REST 用驼峰 inlineData） */
type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } };

interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

/**
 * 把通用 ChatMessage 转换为 Gemini generateContent 的 contents 格式。
 * 关键点：有图时用 inlineData part，data 为裸 base64；角色只允许 user/model。
 */
export function buildGeminiContents(messages: ChatMessage[]): GeminiContent[] {
  return messages.map((m) => {
    const parts: GeminiPart[] = [];
    if (m.content) {
      parts.push({ text: m.content });
    }
    for (const img of m.images ?? []) {
      parts.push({
        inlineData: {
          mimeType: detectImageMime(img),
          data: stripDataUriPrefix(img),
        },
      });
    }
    return { role: m.role === 'user' ? 'user' : 'model', parts };
  });
}

/**
 * 把通用 ChatMessage 转换为 OpenAI /chat/completions 的消息格式。
 * 关键点：有图时 content 必须是多模态数组（text + image_url 部分），
 * 直接透传非标准的 images 字段会被服务端静默丢弃 → 视觉失效。
 */
export function buildOpenAIMessages(
  messages: ChatMessage[],
  systemPrompt?: string
): OpenAIMessage[] {
  const mapped: OpenAIMessage[] = messages.map((m) => {
    if (m.images && m.images.length > 0) {
      const parts: OpenAIContentPart[] = [];
      if (m.content) {
        parts.push({ type: 'text', text: m.content });
      }
      for (const img of m.images) {
        parts.push({ type: 'image_url', image_url: { url: ensureDataUriPrefix(img) } });
      }
      return { role: m.role, content: parts };
    }
    return { role: m.role, content: m.content };
  });

  return systemPrompt
    ? [{ role: 'system', content: systemPrompt }, ...mapped]
    : mapped;
}

async function callOllama(
  config: ProviderConfig,
  request: InferenceRequest
): Promise<InferenceResponse> {
  const messages = buildOllamaMessages(request.messages, request.systemPrompt);

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