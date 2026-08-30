/**
 * 端到端验证：四条 provider 路径的视觉载荷全部正确到达 mock-brain
 *
 * 前置: mock-brain 以 scripted 模式运行（规则需含 "在截图中查找" 的匹配项）
 * 验证方式: 服务端对每个请求解析图片并做 PNG 魔数校验，日志输出 imgs=N；
 *          本脚本断言每条路由都能收到响应，随后人工/自动核对服务日志 imgs=1。
 */
import { runInference } from '../src/inference/engine';
import fs from 'node:fs';

const PNG_PATH = process.argv[2] || `${process.env.TEMP}\\openoxygen-mock\\test-screen.png`;

const CASES = [
  {
    name: 'openai',
    model: { provider: 'openai' as const, model: 'mock-brain', baseUrl: 'http://127.0.0.1:11434/v1', apiKey: 'mock' },
  },
  {
    name: 'anthropic',
    model: { provider: 'anthropic' as const, model: 'mock-brain', baseUrl: 'http://127.0.0.1:11434/v1', apiKey: 'mock' },
  },
  {
    name: 'gemini',
    model: { provider: 'gemini' as const, model: 'mock-brain', baseUrl: 'http://127.0.0.1:11434/v1beta', apiKey: 'mock' },
  },
  {
    name: 'ollama',
    model: { provider: 'ollama' as const, model: 'mock-brain', baseUrl: 'http://127.0.0.1:11434', apiKey: '' },
  },
];

async function main(): Promise<void> {
  const b64 = fs.readFileSync(PNG_PATH).toString('base64');
  console.log(`[test] 图片: ${PNG_PATH} (${b64.length} b64 chars)\n`);

  let failed = 0;
  for (const c of CASES) {
    try {
      const resp = await runInference({
        messages: [
          { role: 'user', content: '在截图中查找目标元素并返回 bounds JSON', images: [b64] },
        ],
        systemPrompt: '你是视觉定位助手',
        model: c.model,
        maxTokens: 300,
      });
      console.log(`[test] ✅ ${c.name.padEnd(9)} → ${resp.content.length} chars: ${resp.content.slice(0, 60).replace(/\n/g, ' ')}`);
    } catch (e) {
      failed++;
      console.error(`[test] ❌ ${c.name.padEnd(9)} → ${e instanceof Error ? e.message : e}`);
    }
  }

  if (failed > 0) {
    console.error(`\n[test] ${failed} 条路径失败`);
    process.exit(1);
  }
  console.log('\n[test] 四条路由全部收到响应。请核对服务端日志: 每条路由应各有一次 imgs=1');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('[test] ❌ 失败:', e instanceof Error ? e.message : e);
    process.exit(1);
  });
