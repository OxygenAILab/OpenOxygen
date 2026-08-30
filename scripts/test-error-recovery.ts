/**
 * 错误恢复验证脚本
 *
 * 故意触发不同类型错误，验证智能重试系统
 */

import { PlanExecutor, type ExecutionContext } from '../src/orchestrator/executor';
import { WindowsGuiController } from '../src/gui/windows';
import { SessionContext } from '../src/orchestrator/context';
import { metrics } from '../src/observability';
import type { TaskPlan } from '../src/orchestrator/planner';

async function testErrorRecovery() {
  console.log('OpenOxygen 错误恢复验证');
  console.log('═'.repeat(60));

  const gui = new WindowsGuiController();
  const executor = new PlanExecutor({
    guiController: gui,
    maxRetries: 3,
    enableReflection: false,
  });

  // 测试场景 1：ElementNotFound（找不到元素）
  console.log('\n[场景 1] ElementNotFound 错误');
  console.log('─'.repeat(60));

  const plan1: TaskPlan = {
    taskId: 'test_error_1',
    version: '2.0',
    description: '测试元素定位失败',
    steps: [
      {
        id: 'step1',
        type: 'gui_click',
        description: '点击不存在的元素',
        params: { target: '这是一个不存在的按钮名称XYZ123' },
        dependencies: [],
        retryConfig: { maxRetries: 3, backoffMs: 1000 },
        timeoutMs: 5000,
        captureScreenshot: false,
        expectedOutcome: '找到并点击',
        rollbackOnFailure: false,
      },
    ],
    dependencies: {},
  };

  const context1: ExecutionContext = {
    taskId: 'test_error_1',
    plan: plan1,
    request: {},
    startTime: Date.now(),
    currentStep: 0,
    results: [],
  };

  const session1 = new SessionContext();

  try {
    const results1 = await executor.execute(context1, session1);
    console.log(`结果: ${results1[0].success ? '成功' : '失败'}`);
    if (results1[0].error) {
      console.log(`错误: ${results1[0].error}`);
    }
  } catch (error) {
    console.log(`异常: ${error}`);
  }

  // 测试场景 2：超时（等待过久）
  console.log('\n[场景 2] Timeout 错误');
  console.log('─'.repeat(60));

  const plan2: TaskPlan = {
    taskId: 'test_error_2',
    version: '2.0',
    description: '测试超时',
    steps: [
      {
        id: 'step1',
        type: 'gui_wait_for',
        description: '等待不会出现的元素',
        params: { target: '永远不会出现的窗口999', timeout: 2000 },
        dependencies: [],
        retryConfig: { maxRetries: 2, backoffMs: 1000 },
        timeoutMs: 2000,
        captureScreenshot: false,
        expectedOutcome: '找到元素',
        rollbackOnFailure: false,
      },
    ],
    dependencies: {},
  };

  const context2: ExecutionContext = {
    taskId: 'test_error_2',
    plan: plan2,
    request: {},
    startTime: Date.now(),
    currentStep: 0,
    results: [],
  };

  const session2 = new SessionContext();

  try {
    const results2 = await executor.execute(context2, session2);
    console.log(`结果: ${results2[0].success ? '成功' : '失败'}`);
    if (results2[0].error) {
      console.log(`错误: ${results2[0].error}`);
    }
  } catch (error) {
    console.log(`异常: ${error}`);
  }

  // 输出 metrics 报告
  console.log('\n' + '═'.repeat(60));
  console.log(metrics.report());
}

testErrorRecovery().catch(console.error);
