/**
 * 性能基准测试
 *
 * 对比不同操作的延迟分布
 */

import { PlanExecutor, type ExecutionContext } from '../src/orchestrator/executor';
import { WindowsGuiController } from '../src/gui/windows';
import { SessionContext } from '../src/orchestrator/context';
import { metrics } from '../src/observability';
import type { TaskPlan } from '../src/orchestrator/planner';

async function benchmarkPerformance() {
  console.log('OpenOxygen 性能基准测试');
  console.log('═'.repeat(60));

  const gui = new WindowsGuiController();
  const executor = new PlanExecutor({
    guiController: gui,
    maxRetries: 1,
    enableReflection: false,
  });

  // 测试 1: 键盘输入性能（10 次）
  console.log('\n[测试 1] 键盘输入性能（10 次重复）');
  console.log('─'.repeat(60));

  for (let i = 1; i <= 10; i++) {
    const plan: TaskPlan = {
      taskId: `benchmark_type_${i}`,
      version: '2.0',
      description: `键盘输入测试 ${i}`,
      steps: [
        {
          id: 'step1',
          type: 'gui_type',
          description: '输入测试文本',
          params: { text: 'Test' },
          dependencies: [],
          retryConfig: { maxRetries: 1, backoffMs: 500 },
          timeoutMs: 5000,
          captureScreenshot: false,
          expectedOutcome: '文本已输入',
          rollbackOnFailure: false,
        },
      ],
      dependencies: {},
    };

    const context: ExecutionContext = {
      taskId: plan.taskId,
      plan,
      request: {},
      startTime: Date.now(),
      currentStep: 0,
      results: [],
    };

    const session = new SessionContext();
    await executor.execute(context, session);
  }

  console.log(`✓ 完成 10 次键盘输入测试`);

  // 测试 2: 等待操作性能（10 次）
  console.log('\n[测试 2] 等待操作性能（10 次重复）');
  console.log('─'.repeat(60));

  for (let i = 1; i <= 10; i++) {
    const plan: TaskPlan = {
      taskId: `benchmark_wait_${i}`,
      version: '2.0',
      description: `等待测试 ${i}`,
      steps: [
        {
          id: 'step1',
          type: 'wait',
          description: '等待 500ms',
          params: { durationMs: 500 },
          dependencies: [],
          retryConfig: { maxRetries: 1, backoffMs: 500 },
          timeoutMs: 5000,
          captureScreenshot: false,
          expectedOutcome: '等待完成',
          rollbackOnFailure: false,
        },
      ],
      dependencies: {},
    };

    const context: ExecutionContext = {
      taskId: plan.taskId,
      plan,
      request: {},
      startTime: Date.now(),
      currentStep: 0,
      results: [],
    };

    const session = new SessionContext();
    await executor.execute(context, session);
  }

  console.log(`✓ 完成 10 次等待测试`);

  // 测试 3: 截图性能（5 次）
  console.log('\n[测试 3] 截图性能（5 次重复）');
  console.log('─'.repeat(60));

  for (let i = 1; i <= 5; i++) {
    const plan: TaskPlan = {
      taskId: `benchmark_screenshot_${i}`,
      version: '2.0',
      description: `截图测试 ${i}`,
      steps: [
        {
          id: 'step1',
          type: 'gui_screenshot',
          description: '截图',
          params: {},
          dependencies: [],
          retryConfig: { maxRetries: 1, backoffMs: 500 },
          timeoutMs: 5000,
          captureScreenshot: false,
          expectedOutcome: '截图完成',
          rollbackOnFailure: false,
        },
      ],
      dependencies: {},
    };

    const context: ExecutionContext = {
      taskId: plan.taskId,
      plan,
      request: {},
      startTime: Date.now(),
      currentStep: 0,
      results: [],
    };

    const session = new SessionContext();
    await executor.execute(context, session);
  }

  console.log(`✓ 完成 5 次截图测试`);

  // 输出性能报告
  console.log('\n' + '═'.repeat(60));
  console.log(metrics.report());
}

benchmarkPerformance().catch(console.error);
