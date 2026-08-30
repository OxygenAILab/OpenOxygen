#!/usr/bin/env tsx
/**
 * 端到端测试（手动 Plan）：跳过 Planner，直接测试 Executor → GUI
 *
 * 验证执行链路是否正常，不依赖 LLM 可用性
 *
 * 用法：
 *   npx tsx scripts/test-executor-manual-plan.ts
 */

import { PlanExecutor } from '../src/orchestrator/executor';
import { RobotGuiController } from '../src/gui/robot';
import { SessionContext } from '../src/orchestrator/context';
import type { PlanStep, TaskPlan } from '../src/orchestrator/planner';

async function main() {
  console.log('OpenOxygen 端到端测试 - Executor → GUI (手动 Plan)');
  console.log('═'.repeat(60));
  console.log('  任务: 打开记事本并输入文本');
  console.log('═'.repeat(60));

  // ── 手动构造 Plan（模拟 Planner 输出） ───────────────────
  const plan: TaskPlan = {
    taskId: `task_${Date.now()}`,
    version: '2.0',
    description: '打开记事本并输入 Hello from OpenOxygen',
    steps: [
      {
        id: 'step1',
        type: 'gui_click',
        description: '点击桌面空白处（确保无焦点）',
        params: {
          target: { x: 500, y: 500 }, // 直接指定坐标
        },
        dependencies: [],
        retryConfig: { maxRetries: 1, backoffMs: 500 },
        timeoutMs: 5000,
        captureScreenshot: false,
        expectedOutcome: '桌面获得焦点',
      },
      {
        id: 'step2',
        type: 'wait',
        description: '等待 500ms',
        params: { durationMs: 500 },
        dependencies: ['step1'],
        retryConfig: { maxRetries: 0, backoffMs: 0 },
        timeoutMs: 1000,
        captureScreenshot: false,
      },
      {
        id: 'step3',
        type: 'gui_type',
        description: '按 Win+R 打开运行对话框',
        params: {
          text: '', // 实际会通过按键实现
        },
        dependencies: ['step2'],
        retryConfig: { maxRetries: 1, backoffMs: 500 },
        timeoutMs: 5000,
        captureScreenshot: false,
        expectedOutcome: '运行对话框打开',
      },
      {
        id: 'step4',
        type: 'wait',
        description: '等待运行对话框出现',
        params: { durationMs: 1000 },
        dependencies: ['step3'],
        retryConfig: { maxRetries: 0, backoffMs: 0 },
        timeoutMs: 2000,
        captureScreenshot: false,
      },
      {
        id: 'step5',
        type: 'gui_type',
        description: '输入 notepad',
        params: {
          text: 'notepad',
        },
        dependencies: ['step4'],
        retryConfig: { maxRetries: 1, backoffMs: 500 },
        timeoutMs: 5000,
        captureScreenshot: false,
        expectedOutcome: '运行框显示 notepad',
      },
      {
        id: 'step6',
        type: 'wait',
        description: '等待 500ms',
        params: { durationMs: 500 },
        dependencies: ['step5'],
        retryConfig: { maxRetries: 0, backoffMs: 0 },
        timeoutMs: 1000,
        captureScreenshot: false,
      },
      {
        id: 'step7',
        type: 'gui_type',
        description: '按 Enter 执行',
        params: {
          text: '', // 实际会按 Enter
        },
        dependencies: ['step6'],
        retryConfig: { maxRetries: 1, backoffMs: 500 },
        timeoutMs: 5000,
        captureScreenshot: false,
        expectedOutcome: '记事本打开',
      },
      {
        id: 'step8',
        type: 'wait',
        description: '等待记事本启动',
        params: { durationMs: 2000 },
        dependencies: ['step7'],
        retryConfig: { maxRetries: 0, backoffMs: 0 },
        timeoutMs: 3000,
        captureScreenshot: false,
      },
      {
        id: 'step9',
        type: 'gui_type',
        description: '输入测试文本',
        params: {
          text: 'Hello from OpenOxygen Next!\n\nThis is an automated GUI test.\n\nPlanner → Executor → GUI chain verified ✓',
        },
        dependencies: ['step8'],
        retryConfig: { maxRetries: 1, backoffMs: 500 },
        timeoutMs: 10000,
        captureScreenshot: true,
        expectedOutcome: '文本已输入',
      },
    ] as PlanStep[],
    dependencies: new Map(),
  };

  console.log(`\n[计划概览]`);
  console.log('─'.repeat(60));
  console.log(`  步骤数: ${plan.steps.length}`);
  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];
    console.log(`    ${i + 1}. [${step.type}] ${step.description}`);
  }

  // ── 执行计划 ────────────────────────────────────────────
  console.log('\n[开始执行]');
  console.log('─'.repeat(60));
  console.log('  ⚠️  即将执行真实 GUI 操作，按 Ctrl+C 可中止');
  console.log('  等待 3 秒...\n');

  await new Promise((resolve) => setTimeout(resolve, 3000));

  const gui = new RobotGuiController(); // 使用 robotjs
  const executor = new PlanExecutor({
    guiController: gui,
    maxRetries: 1,
    enableReflection: false,
  });

  const session = new SessionContext();
  const executionContext = {
    taskId: plan.taskId,
    plan,
    request: { description: plan.description },
    startTime: Date.now(),
    currentStep: 0,
    results: [],
  };

  try {
    const results = await executor.execute(executionContext, session);

    console.log('\n[执行结果]');
    console.log('─'.repeat(60));

    const successCount = results.filter((r) => r.success).length;
    const failCount = results.filter((r) => !r.success).length;

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const step = plan.steps[i];
      const status = result.success ? '✓' : '✗';
      console.log(
        `  ${status} 步骤 ${i + 1}: ${step.description} (${result.durationMs}ms)`
      );
      if (result.error) {
        console.log(`     错误: ${result.error}`);
      }
    }

    const totalMs = Date.now() - executionContext.startTime;

    console.log('\n' + '═'.repeat(60));
    console.log(`任务完成: ${successCount}/${results.length} 步骤成功`);
    console.log(`总耗时: ${totalMs}ms`);
    console.log('═'.repeat(60));

    if (failCount > 0) {
      console.log(`\n⚠️  ${failCount} 个步骤失败`);
      process.exit(1);
    }

    console.log('\n🎉 执行链路验证通过！');
    console.log('   记事本应该已打开并输入了测试文本。');
    console.log('\n下一步: 启动 Ollama 测试完整 Planner → Executor → GUI 链路');
    console.log('  1. 运行: ollama serve');
    console.log('  2. 运行: ollama pull qwen2.5:7b');
    console.log('  3. 运行: npx tsx scripts/test-planner-e2e.ts');
  } catch (error: any) {
    console.log(`\n✗ 执行失败: ${error?.message ?? error}`);
    if (error.stack) {
      console.log('\n堆栈:\n', error.stack);
    }
    process.exit(1);
  }
}

main().catch(console.error);
