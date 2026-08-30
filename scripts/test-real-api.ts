/**
 * 真实 API 全链路验证:引擎 openai 路径 + 视觉 + 真实模型
 * 环境变量: OPENOXYGEN_PLANNER_API_KEY / OPENOXYGEN_PLANNER_BASE_URL / OPENOXYGEN_PLANNER_MODEL
 */
import { runInference } from '../src/inference/engine';
import fs from 'node:fs';

async function main(): Promise<void> {
  const pngPath = process.argv[2] || `${process.env.TEMP}\\openoxygen-mock\\test-screen.png`;
  const b64 = fs.readFileSync(pngPath).toString('base64');

  console.log('[real-test] 1) 文本推理...');
  const text = await runInference({
    messages: [{ role: 'user', content: '用 JSON 回答: {"status":"ok"} 别的什么都不要输出' }],
    model: {
      provider: 'openai',
      model: process.env.OPENOXYGEN_PLANNER_MODEL || 'glm-5.3-flash',
      baseUrl: process.env.OPENOXYGEN_PLANNER_BASE_URL || 'https://api.ldwnb666.xyz/v1',
      apiKey: process.env.OPENOXYGEN_PLANNER_API_KEY || '',
    },
    maxTokens: 2000,
  });
  console.log(`  content: ${text.content.slice(0, 100)}`);
  if (!text.content.includes('ok')) throw new Error('文本推理返回异常');

  console.log('[real-test] 2) 视觉推理(走 buildOpenAIMessages 多模态路径)...');
  const vision = await runInference({
    messages: [
      {
        role: 'user',
        content: '简述这张截图的内容(一句话,中文)',
        images: [b64],
      },
    ],
    model: {
      provider: 'openai',
      model: process.env.OPENOXYGEN_PLANNER_MODEL || 'glm-5.3-flash',
      baseUrl: process.env.OPENOXYGEN_PLANNER_BASE_URL || 'https://api.ldwnb666.xyz/v1',
      apiKey: process.env.OPENOXYGEN_PLANNER_API_KEY || '',
    },
    maxTokens: 2000,
  });
  const desc = vision.content.trim();
  console.log(`  content: ${desc.slice(0, 150)}`);
  if (!desc || desc.length < 5) throw new Error('视觉推理返回空内容');

  console.log('\n[real-test] ✅ 真实 API: 文本 + 视觉 双通道全链路通过');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('[real-test] ❌ 失败:', e instanceof Error ? e.message : e);
    process.exit(1);
  });
