/**
 * 端到端验证：ChatMessage.images 走 OpenAI 兼容路由不再被丢弃
 * 前置：mock-brain-server 以 live 模式运行于 11434
 */
import { runInference } from '../src/inference/engine';
import fs from 'node:fs';

async function main(): Promise<void> {
  const pngPath = process.argv[2] || `${process.env.TEMP}\\openoxygen-mock\\test-screen.png`;
  const b64 = fs.readFileSync(pngPath).toString('base64');

  console.log(`[test] 发送含图请求 → openai 路由 (图片 ${b64.length} b64 chars)`);
  console.log('[test] 注意: 若引擎仍透传 images 字段, 服务端将收不到任何图');

  const response = await runInference({
    messages: [
      {
        role: 'user',
        content: '在截图中查找目标并返回 JSON bounds',
        images: [b64],
      },
    ],
    systemPrompt: '你是视觉定位助手',
    model: {
      provider: 'openai',
      model: 'mock-brain',
      baseUrl: 'http://127.0.0.1:11434/v1',
      apiKey: 'mock',
    },
    maxTokens: 500,
  });

  console.log(`[test] 收到响应 (${response.content.length} chars): ${response.content.slice(0, 120)}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('[test] ❌ 失败:', e instanceof Error ? e.message : e);
    process.exit(1);
  });
