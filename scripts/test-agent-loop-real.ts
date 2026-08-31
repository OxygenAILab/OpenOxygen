/**
 * AgentLoop 真实 API 冒烟:无害任务全链路
 * 目标设计为只读/无害动作:截图观察 → cli echo → finish(不动鼠标键盘)
 *
 * 环境变量: OPENOXYGEN_PLANNER_API_KEY / OPENOXYGEN_PLANNER_BASE_URL / OPENOXYGEN_PLANNER_MODEL
 */
import { AgentLoop } from '../src/orchestrator/agent-loop';
import { NodeCliExecutor } from '../src/cli/executor';
import { RobotGuiController } from '../src/gui/robot';

async function main(): Promise<void> {
  const apiKey = process.env.OPENOXYGEN_PLANNER_API_KEY;
  if (!apiKey) throw new Error('缺少 OPENOXYGEN_PLANNER_API_KEY');

  // 安全冒烟:GUI 只暴露 screenshot(只读),物理上不存在点击/按键能力
  const robot = new RobotGuiController();
  const screenshotOnlyGui = {
    screenshot: () => robot.screenshot(),
  };

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
    gui: screenshotOnlyGui,
    cli: new NodeCliExecutor(),
    maxSteps: 12,
  });

  console.log('\n[smoke] ═══════════════════════════════');
  console.log(`[smoke] success: ${result.success}`);
  console.log(`[smoke] steps:   ${result.steps}`);
  console.log(`[smoke] summary: ${result.summary.slice(0, 300)}`);
  if (result.error) console.log(`[smoke] error:   ${result.error}`);

  // 无 GUI 时 screenshot 必须诚实报错,LLM 应回退到纯 cli+finish 路线
  process.exitCode = result.success ? 0 : 1;
}

main().catch((e) => {
  console.error('[smoke] ❌', e instanceof Error ? e.message : e);
  process.exit(1);
});
