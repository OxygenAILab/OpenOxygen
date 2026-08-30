#!/usr/bin/env tsx
/**
 * Mock Brain Server —— 本地"大脑"替身，拦截 LLM 流量做实时/脚本化回归
 *
 * 原理：Planner 与 Vision 的真实代码路径都是 fetch → baseUrl，零侵入。
 * 本服务器监听同一端口，同时实现两套协议：
 *   - POST /v1/chat/completions  （OpenAI 兼容，SimplePlanner 消费）
 *   - POST /api/chat             （Ollama 协议，Vision 消费，含截图）
 *
 * 两种模式：
 *   live    请求落盘到 --dir（截图解码成图片文件）→ 阻塞等待外部写入响应文件
 *           → 外部 AI（小氧）用 Read 看 prompt 与截图，Write 写回响应 = 实时大脑
 *           响应约定：优先 <id>/response.json 取 {"content": "..."}；
 *                     否则 <id>/response.txt 整个文件内容即为 content（免转义）
 *   scripted 按 --script 规则文件的 match 子串匹配 prompt，返回固定 content，
 *            用于无人值守自动化回归
 *
 * 用法：
 *   node_modules\.bin\tsx.cmd scripts\mock-brain-server.ts --mode live
 *   node_modules\.bin\tsx.cmd scripts\mock-brain-server.ts --mode scripted --script scripts\mock-brain-scripts\demo.json
 *
 * 让 Planner 指向本服务（另开终端）：
 *   $env:OPENOXYGEN_PLANNER_API_KEY = "mock"
 *   $env:OPENOXYGEN_PLANNER_BASE_URL = "http://localhost:11434/v1"
 *   npx tsx scripts/test-planner-e2e.ts "打开记事本输入 hello"
 * Vision 无需任何配置（VISION_MODELS 硬编码 localhost:11434）。
 */

import * as http from 'http';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';

// ── CLI 参数 ──────────────────────────────────────────────

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const PORT = parseInt(arg('--port', '11434'), 10);
const MODE = arg('--mode', 'live'); // live | scripted
const WORK_DIR = path.resolve(arg('--dir', path.join('output', 'mock-brain')));
const SCRIPT_FILE = arg('--script', '');
const WAIT_TIMEOUT_MS = parseInt(arg('--timeout', '600000'), 10);

// ── Scripted 模式规则 ─────────────────────────────────────

interface ScriptRule {
  match: string;
  content: string;
}

function loadScripts(): ScriptRule[] {
  if (!SCRIPT_FILE) {
    console.error('[mock-brain] scripted 模式需要 --script <rules.json>');
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(SCRIPT_FILE, 'utf-8'));
  const rules: ScriptRule[] = Array.isArray(raw) ? raw : raw.rules;
  if (!Array.isArray(rules) || rules.length === 0) {
    console.error('[mock-brain] 脚本文件为空或格式错误');
    process.exit(1);
  }
  return rules;
}

// ── 请求解析 ──────────────────────────────────────────────

type Route = 'openai' | 'ollama' | 'anthropic' | 'gemini';

interface BrainRequest {
  route: Route;
  model: string;
  /** 拼接后的可读 prompt（system + 各消息） */
  promptText: string;
  /** 解码后的图片 buffer */
  images: Buffer[];
  /** 图片是否为合法 PNG（robotjs 截图是裸 bitmap，可能不是） */
  imagesArePng: boolean[];
}

function parseBody(route: Route, body: any): BrainRequest {
  // Gemini 的请求体是 contents[].parts[]，归一化为统一的 messages 形状
  const messages: Array<{ role: string; content: any; images?: string[] }> =
    route === 'gemini'
      ? (body.contents ?? []).map((c: any) => ({
          role: String(c?.role ?? 'user'),
          content: ((c?.parts ?? []) as any[])
            .filter((p) => typeof p?.text === 'string')
            .map((p) => p.text)
            .join('\n'),
        }))
      : body.messages || [];
  const parts: string[] = [];

  for (const m of messages) {
    let text = '';
    if (typeof m.content === 'string') {
      text = m.content;
    } else if (Array.isArray(m.content)) {
      // OpenAI 多模态 content 数组：抽取 text 部分
      text = m.content
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text)
        .join('\n');
    }
    const prefix = m.role === 'system' ? '[system]' : `[${m.role}]`;
    parts.push(`${prefix}\n${text}`);
  }

  // 图片：Ollama 在 messages[].images（裸 base64）；OpenAI 多模态在 content 的 image_url；
  // Anthropic 在 messages[].content[].source.data（裸 base64）；Gemini 在 contents[].parts[].inlineData.data
  const images: Buffer[] = [];
  for (const m of messages) {
    if (Array.isArray(m.images)) {
      for (const b64 of m.images) {
        images.push(Buffer.from(String(b64).replace(/^data:[^;]+;base64,/, ''), 'base64'));
      }
    }
    if (Array.isArray(m.content)) {
      for (const c of m.content) {
        const url: string | undefined = c?.image_url?.url;
        if (url) {
          images.push(Buffer.from(url.replace(/^data:[^;]+;base64,/, ''), 'base64'));
        }
      }
    }
    if (route === 'anthropic' && Array.isArray(m.content)) {
      for (const c of m.content) {
        const data: string | undefined = c?.source?.data;
        if (c?.type === 'image' && data) {
          images.push(Buffer.from(String(data), 'base64'));
        }
      }
    }
  }
  if (route === 'gemini' && Array.isArray(body.contents)) {
    for (const c of body.contents) {
      for (const p of (c?.parts ?? []) as any[]) {
        const d = p?.inlineData?.data ?? p?.inline_data?.data;
        if (d) {
          images.push(Buffer.from(String(d), 'base64'));
        }
      }
    }
  }

  const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  return {
    route,
    model: String(body.model || 'unknown'),
    promptText: parts.join('\n\n'),
    images,
    imagesArePng: images.map((b) => b.subarray(0, 4).equals(pngMagic)),
  };
}

// ── 响应包装 ──────────────────────────────────────────────

function wrapResponse(route: Route, model: string, content: string): any {
  if (route === 'ollama') {
    return {
      model,
      created_at: new Date().toISOString(),
      message: { role: 'assistant', content },
      done: true,
    };
  }
  if (route === 'anthropic') {
    const tokens = Math.ceil(content.length / 4);
    return {
      id: `msg_mock-${Date.now()}`,
      type: 'message',
      role: 'assistant',
      model,
      content: [{ type: 'text', text: content }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 0, output_tokens: tokens },
    };
  }
  if (route === 'gemini') {
    return {
      candidates: [
        { content: { parts: [{ text: content }], role: 'model' }, finishReason: 'STOP' },
      ],
      model,
    };
  }
  const tokens = Math.ceil(content.length / 4);
  return {
    id: `mock-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: tokens, total_tokens: tokens },
  };
}

// ── Live 模式：落盘 + 阻塞等待 ────────────────────────────

async function handleLive(req: BrainRequest): Promise<string> {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const dir = path.join(WORK_DIR, id);
  await fsp.mkdir(path.join(dir, 'images'), { recursive: true });

  await fsp.writeFile(
    path.join(dir, 'request.json'),
    JSON.stringify({ route: req.route, model: req.model, prompt: req.promptText }, null, 2),
    'utf-8'
  );
  await fsp.writeFile(
    path.join(dir, 'meta.json'),
    JSON.stringify(
      {
        route: req.route,
        model: req.model,
        receivedAt: new Date().toISOString(),
        imagesCount: req.images.length,
        imagesArePng: req.imagesArePng,
        hint:
          '外部大脑：Read request.json 与 images/*（PNG 可预览），Write response.json {"content":"..."} 或 response.txt 纯文本',
      },
      null,
      2
    ),
    'utf-8'
  );

  for (let i = 0; i < req.images.length; i++) {
    const ext = req.imagesArePng[i] ? 'png' : 'raw';
    await fsp.writeFile(path.join(dir, 'images', `img-${i}.${ext}`), req.images[i]);
  }

  console.log(`[mock-brain] ⏳ ${id} 等待大脑响应… (${req.route}, ${req.images.length} 图) → ${dir}`);

  const start = Date.now();
  while (Date.now() - start < WAIT_TIMEOUT_MS) {
    const jsonPath = path.join(dir, 'response.json');
    const txtPath = path.join(dir, 'response.txt');

    if (fs.existsSync(jsonPath)) {
      try {
        const parsed = JSON.parse(await fsp.readFile(jsonPath, 'utf-8'));
        if (typeof parsed.content === 'string' && parsed.content.length > 0) {
          return parsed.content;
        }
        console.warn('[mock-brain] response.json 缺少非空 content 字段，继续等待…');
      } catch {
        console.warn('[mock-brain] response.json 解析失败（可能写到一半），继续等待…');
      }
    }
    if (fs.existsSync(txtPath)) {
      const txt = await fsp.readFile(txtPath, 'utf-8');
      if (txt.trim().length > 0) {
        return txt;
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  throw new Error(`等待大脑响应超时（${WAIT_TIMEOUT_MS}ms）：${dir}`);
}

// ── Scripted 模式：规则匹配 ───────────────────────────────

function handleScripted(req: BrainRequest, rules: ScriptRule[]): string {
  const lower = req.promptText.toLowerCase();
  for (const rule of rules) {
    if (lower.includes(rule.match.toLowerCase())) {
      console.log(`[mock-brain] 📜 命中规则 "${rule.match}"`);
      return typeof rule.content === 'string' ? rule.content : JSON.stringify(rule.content);
    }
  }
  console.warn('[mock-brain] ⚠️ 无命中规则，返回空计划兜底');
  return '{"steps": []}';
}

// ── HTTP 服务 ─────────────────────────────────────────────

const rules = MODE === 'scripted' ? loadScripts() : null;

async function readBody(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf-8'));
}

const server = http.createServer(async (req, res) => {
  // 剥离查询串（如 Gemini 的 ?key=xxx），否则带 $ 锚点的路由匹配会失败
  const url = (req.url || '').split('?')[0];

  try {
    if (req.method === 'GET' && (url === '/' || url === '/health')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, mode: MODE, port: PORT }));
      return;
    }

    let route: Route | null = null;
    if (req.method === 'POST' && url.endsWith('/v1/chat/completions')) route = 'openai';
    if (req.method === 'POST' && url.endsWith('/api/chat')) route = 'ollama';
    if (req.method === 'POST' && url.endsWith('/v1/messages')) route = 'anthropic';
    if (req.method === 'POST' && /\/models\/[^/]+:generateContent$/.test(url)) route = 'gemini';

    if (!route) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `mock-brain: 未实现的端点 ${req.method} ${url}` }));
      return;
    }

    const body = await readBody(req);
    const brainReq = parseBody(route, body);

    console.log('─'.repeat(60));
    console.log(`[mock-brain] 📥 ${route} model=${brainReq.model} imgs=${brainReq.images.length}`);
    console.log(`[mock-brain] prompt 前 120 字符: ${brainReq.promptText.slice(0, 120).replace(/\n/g, ' ')}`);

    const startedAt = Date.now();
    const content =
      MODE === 'live' ? await handleLive(brainReq) : handleScripted(brainReq, rules!);

    console.log(`[mock-brain] 📤 响应 ${content.length} 字符，耗时 ${Date.now() - startedAt}ms`);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(wrapResponse(route, brainReq.model, content)));
  } catch (error: any) {
    console.error(`[mock-brain] ✗ ${error?.message ?? error}`);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: String(error?.message ?? error) }));
  }
});

server.listen(PORT, () => {
  console.log('═'.repeat(60));
  console.log(`[mock-brain] 🧠 Mock Brain Server 已启动`);
  console.log(`  模式: ${MODE}${MODE === 'scripted' ? ` (${SCRIPT_FILE})` : ''}`);
  console.log(`  端口: ${PORT}（Planner: /v1/chat/completions · Vision: /api/chat）`);
  if (MODE === 'live') console.log(`  工作目录: ${WORK_DIR}`);
  console.log('═'.repeat(60));
});

process.on('SIGINT', () => {
  console.log('\n[mock-brain] 收到 SIGINT，关闭');
  server.close(() => process.exit(0));
});
