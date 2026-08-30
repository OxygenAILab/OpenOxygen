/**
 * Pre-Release 功能基准：单进程内自起 mock-brain 子进程 → Planner + 四供应商视觉基准 → 收尸
 * 退出码 0 = 全部通过
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..');
const PORT = 11434;

async function waitHealth(timeoutMs = 30000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/health`);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('mock-brain server did not start in time');
}

async function main(): Promise<void> {
  const server = spawn(
    process.execPath,
    [
      path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
      'scripts/mock-brain-server.ts',
      '--mode', 'scripted',
      '--script', 'scripts/mock-brain-scripts/demo.json',
    ],
    { cwd: ROOT, stdio: 'pipe' }
  );
  const serverLogs: string[] = [];
  server.stdout?.on('data', (d) => serverLogs.push(String(d)));
  server.stderr?.on('data', (d) => serverLogs.push(String(d)));

  let failed = 0;
  try {
    await waitHealth();
    console.log('[bench] mock-brain server ready');

    // ── 基准 1: Planner(scripted) ──
    process.env.OPENOXYGEN_PLANNER_BASE_URL = `http://127.0.0.1:${PORT}/v1`;
    process.env.OPENOXYGEN_PLANNER_API_KEY = 'mock';
    process.env.OPENOXYGEN_PLANNER_MODEL = 'mock-brain';
    const { generatePlan } = await import('../src/orchestrator/simple-planner');
    const plan = await generatePlan('打开记事本并输入 hello');
    const planOk = plan.steps.length >= 3;
    if (!planOk) failed++;
    console.log(`[bench] ${planOk ? '✅' : '❌'} Planner: ${plan.steps.length} steps, deps valid`);

    // ── 基准 2: 四供应商视觉载荷 ──
    const { runInference } = await import('../src/inference/engine');
    // 合成 800x500 测试图（使用产品 PNG 编码器，自包含且无外部依赖）
    const { encodeBitmapToPng } = await import('../src/gui/robot');
    const W = 800, H = 500;
    const bgra = Buffer.alloc(W * H * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        bgra[i] = (x * 255) / W; // B
        bgra[i + 1] = (y * 255) / H; // G
        bgra[i + 2] = 128; // R
        bgra[i + 3] = 255; // A
      }
    }
    const pngPath = path.join(process.env.TEMP || '/tmp', 'openoxygen-bench.png');
    fs.writeFileSync(pngPath, encodeBitmapToPng(W, H, bgra));
    const b64 = fs.readFileSync(pngPath).toString('base64');

    const cases = [
      { name: 'openai', model: { provider: 'openai' as const, model: 'mock-brain', baseUrl: `http://127.0.0.1:${PORT}/v1`, apiKey: 'mock' } },
      { name: 'anthropic', model: { provider: 'anthropic' as const, model: 'mock-brain', baseUrl: `http://127.0.0.1:${PORT}/v1`, apiKey: 'mock' } },
      { name: 'gemini', model: { provider: 'gemini' as const, model: 'mock-brain', baseUrl: `http://127.0.0.1:${PORT}/v1beta`, apiKey: 'mock' } },
      { name: 'ollama', model: { provider: 'ollama' as const, model: 'mock-brain', baseUrl: `http://127.0.0.1:${PORT}`, apiKey: '' } },
    ];
    for (const c of cases) {
      try {
        const r = await runInference({
          messages: [{ role: 'user', content: '在截图中查找目标元素', images: [b64] }],
          systemPrompt: '你是视觉定位助手',
          model: c.model,
          maxTokens: 300,
        });
        const ok = r.content.length > 0;
        if (!ok) failed++;
        console.log(`[bench] ${ok ? '✅' : '❌'} vision/${c.name}: ${r.content.length} chars`);
      } catch (e) {
        failed++;
        console.error(`[bench] ❌ vision/${c.name}: ${e instanceof Error ? e.message : e}`);
      }
    }

    // 服务端必须收到 4 次带图请求（imgs=1 日志计数）
    await new Promise((r) => setTimeout(r, 1500));
    const joined = serverLogs.join('');
    const imgHits = joined.match(/imgs=\d/g) ?? [];
    for (const line of joined.split('\n')) {
      if (line.includes('📥')) console.log(`  [server] ${line.trim().slice(0, 90)}`);
    }
    const pngVerified = imgHits.filter((s) => s === 'imgs=1').length >= 4;
    if (!pngVerified) failed++;
    console.log(`[bench] ${pngVerified ? '✅' : '❌'} 服务端收到带图请求: ${imgHits.filter((s) => s === 'imgs=1').length}/4`);

    console.log(failed === 0 ? '\n[bench] ✅ 功能基准全部通过' : `\n[bench] ❌ ${failed} 项失败`);
    process.exitCode = failed === 0 ? 0 : 1;
  } finally {
    server.kill('SIGTERM');
    // 给子进程一点时间退出
    await new Promise((r) => setTimeout(r, 800));
    if (!server.killed) server.kill('SIGKILL');
  }
}

main().catch((e) => {
  console.error('[bench] ❌', e instanceof Error ? e.message : e);
  process.exit(1);
});
