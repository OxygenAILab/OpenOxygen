#!/usr/bin/env tsx
/**
 * 测试 executor 动作分发
 *
 * 验证 PlanExecutor 能否正确将 step.type 路由到对应的 GUI 方法。
 *
 * 用法：
 *   npx tsx scripts/test-executor-dispatch.ts
 */

import { PlanExecutor } from '../src/orchestrator/executor';
import { WindowsGuiController } from '../src/gui/windows';
import { SessionContext } from '../src/orchestrator/context';
import type { PlanStep } from '../src/orchestrator/planner';

async function main() {
  console.log('OpenOxygen 测试 - Executor 动作分发');
  console.log('═'.repeat(60));

  const gui = new WindowsGuiController();
  const executor = new PlanExecutor({
    guiController: gui,
    maxRetries: 0,
    enableReflection: false,
  });

  const session = new SessionContext();

  // ── 测试 1: gui_click ──────────────────────────────────
  console.log('\n[测试 1] gui_click → 定位并点击目标');
  console.log('─'.repeat(60));

  const clickStep: PlanStep = {
    id: 'test-click',
    type: 'gui_click',
    description: '点击智能体标签',
    params: { target: '智能体', button: 'left' },
    dependencies: [],
    expectedOutcome: '标签被点击',
  };

  try {
    // @ts-ignore - 直接调用 private 方法测试
    const result = await executor['executeStep'](clickStep, null, session);
    console.log(`  结果: ${result.success ? '✓ 成功' : '✗ 失败'}`);
    console.log(`  耗时: ${result.durationMs}ms`);
    if (result.error) {
      console.log(`  错误: ${result.error}`);
    }
    console.log(`\n  请确认是否点击了"智能体"标签。`);
  } catch (err: any) {
    console.log(`  ✗ 异常: ${err?.message ?? err}`);
  }

  // 等待 2 秒，让用户观察结果
  await new Promise(resolve => setTimeout(resolve, 2000));

  // ── 测试 2: gui_screenshot ────────────────────────────
  console.log('\n[测试 2] gui_screenshot → 截图');
  console.log('─'.repeat(60));

  const screenshotStep: PlanStep = {
    id: 'test-screenshot',
    type: 'gui_screenshot',
    description: '截图当前屏幕',
    params: {},
    dependencies: [],
    expectedOutcome: '返回截图 base64',
  };

  try {
    // @ts-ignore
    const result = await executor['executeStep'](screenshotStep, null, session);
    console.log(`  结果: ${result.success ? '✓ 成功' : '✗ 失败'}`);
    console.log(`  耗时: ${result.durationMs}ms`);
    if (result.success && result.output) {
      const outputStr = typeof result.output === 'string' ? result.output : '';
      console.log(`  截图大小: ${Math.round(outputStr.length / 1024)} KB`);
    }
    if (result.error) {
      console.log(`  错误: ${result.error}`);
    }
  } catch (err: any) {
    console.log(`  ✗ 异常: ${err?.message ?? err}`);
  }

  // ── 测试 3: gui_wait_for ───────────────────────────────
  console.log('\n[测试 3] gui_wait_for → 等待元素出现');
  console.log('─'.repeat(60));

  const waitStep: PlanStep = {
    id: 'test-wait',
    type: 'gui_wait_for',
    description: '等待智能体标签出现',
    params: { target: '智能体', timeout: 5000 },
    dependencies: [],
    expectedOutcome: '元素存在',
  };

  try {
    // @ts-ignore
    const result = await executor['executeStep'](waitStep, null, session);
    console.log(`  结果: ${result.success ? '✓ 成功' : '✗ 失败'}`);
    console.log(`  耗时: ${result.durationMs}ms`);
    if (result.success && result.output) {
      console.log(`  找到元素: (${result.output.x}, ${result.output.y})`);
    }
    if (result.error) {
      console.log(`  错误: ${result.error}`);
    }
  } catch (err: any) {
    console.log(`  ✗ 异常: ${err?.message ?? err}`);
  }

  console.log('\n' + '═'.repeat(60));
  console.log('测试完成');
  console.log('═'.repeat(60));
  console.log('\n关键验证点:');
  console.log('  1. gui_click 能否触发真实点击？');
  console.log('  2. gui_screenshot 能否返回截图 base64？');
  console.log('  3. gui_wait_for 能否找到存在的元素？');
  console.log('\n如果以上 3 项都通过，说明 executor 的 GUI 动作分发正常 ✓');
}

main().catch(console.error);
