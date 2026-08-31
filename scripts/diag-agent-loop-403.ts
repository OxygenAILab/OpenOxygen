/**
 * 403 诊断冒烟:monkey-patch fetch 抓取 AgentLoop 实际外发的请求体,
 * 失败后原样重发 3 次——若原样重发成功,差异在进程/连接层;若仍 403,差异在请求内容。
 */
import { AgentLoop } from '../src/orchestrator/agent-loop';
import { NodeCliExecutor } from '../src/cli/executor';
import { RobotGuiController } from '../src/gui/robot';

const captured: Array<{ url: string; body: string }> = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url: any, init: any) => {
  if (String(url).includes('chat/completions') && init?.body) {
    captured.push({ url: String(url), body: String(init.body) });
  }
  return realFetch(url, init);
};

async function rawReplay(body: string, n = 3): Promise<void> {
  for (let i = 1; i <= n; i++) {
    const r = await realFetch('https://api.ldwnb666.xyz/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENOXYGEN_PLANNER_API_KEY}`,
      },
      body,
    });
    console.log(`  [replay ${i}] HTTP ${r.status} :: ${(await r.text()).slice(0, 80).replace(/\n/g, ' ')}`);
    if (r.status === 200) return;
    await new Promise((res) => setTimeout(res, 2000));
  }
}

async function main(): Promise<void> {
  const apiKey = process.env.OPENOXYGEN_PLANNER_API_KEY;
  if (!apiKey) throw new Error('缺少 OPENOXYGEN_PLANNER_API_KEY');

  const robot = new RobotGuiController();
  const loop = new AgentLoop();
  const result = await loop.run({
    goal: [
      '完成以下三件事后结束:',
      '1. 调用 screenshot 工具截取屏幕;',
      '2. 看最新一张截图,说出最显眼的窗口标题;',
      '3. 调用 cli 工具执行 "echo agent-loop-smoke-ok" 并确认输出;',
      '最后调用 finish,summary 里包含窗口标题和 echo 的结果。',
    ].join('\n'),
    model: {
      provider: 'openai',
      model: process.env.OPENOXYGEN_PLANNER_MODEL || 'glm-5.3-flash',
      baseUrl: process.env.OPENOXYGEN_PLANNER_BASE_URL || 'https://api.ldwnb666.xyz/v1',
      apiKey,
    },
    gui: { screenshot: () => robot.screenshot() },
    cli: new NodeCliExecutor(),
    maxSteps: 12,
  });

  console.log(`\n[smoke] success=${result.success} steps=${result.steps}`);
  if (!result.success && captured.length > 0) {
    const last = captured[captured.length - 1];
    console.log(`[diag] 最后一次外发请求: ${last.body.length} bytes`);
    console.log('[diag] 原样重发 3 次(同一进程、同一连接池):');
    await rawReplay(last.body);
  }
  process.exitCode = result.success ? 0 : 1;
}

main().catch((e) => {
  console.error('[smoke] ❌', e instanceof Error ? e.message : e);
  process.exit(1);
});
