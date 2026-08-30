/**
 * 可观测性测试脚本
 *
 * 验证结构化日志和 metrics 收集
 */

import { logger, metrics } from '../src/observability';

async function testObservability() {
  console.log('OpenOxygen 可观测性测试');
  console.log('════════════════════════════════════════\n');

  // 模拟任务执行
  const taskId = 'test_task_001';

  logger.taskStart(taskId, '测试任务：打开记事本', 'execute');

  // 模拟规划阶段
  logger.planStart(taskId, '生成执行计划');
  await delay(500);
  logger.planEnd(taskId, true, 5);
  metrics.recordPlan(true, 500);
  metrics.recordTokens('cerebras', 250, 180);

  // 模拟步骤执行
  const steps = [
    { id: 'step1', type: 'gui_type', description: '打开运行对话框', durationMs: 700, success: true },
    { id: 'step2', type: 'wait', description: '等待对话框加载', durationMs: 500, success: true },
    { id: 'step3', type: 'gui_type', description: '输入 notepad', durationMs: 600, success: true },
    { id: 'step4', type: 'gui_click', description: '点击按钮', durationMs: 1200, success: false },
    { id: 'step5', type: 'gui_screenshot', description: '截图', durationMs: 800, success: true },
  ];

  for (const step of steps) {
    logger.stepStart(taskId, step.id, step.type, step.description, );
    await delay(step.durationMs);

    if (!step.success) {
      // 模拟错误恢复
      logger.stepEnd(taskId, step.id, step.type, false, undefined, 'Element not found');
      metrics.recordStep(step.type, false, step.durationMs);

      // 重试 2 次
      for (let attempt = 1; attempt <= 2; attempt++) {
        logger.retry(taskId, step.id, attempt, 2, 'element_not_found', {
          shouldRelocate: true,
          delayMs: 1000,
        });

        await delay(1000);

        if (attempt === 2) {
          // 第二次成功
          logger.stepEnd(taskId, step.id, step.type, true, { retried: true }, undefined);
          metrics.recordStep(step.type, true, 1200);
          metrics.recordRetry('element_not_found', true);
        } else {
          metrics.recordRetry('element_not_found', false);
        }
      }
    } else {
      logger.stepEnd(taskId, step.id, step.type, true, { done: true }, undefined);
      metrics.recordStep(step.type, true, step.durationMs);
    }
  }

  // 模拟定位器使用
  metrics.recordLocator('uia', true);
  metrics.recordLocator('uia', true);
  metrics.recordLocator('uia', false);
  metrics.recordLocator('vlm', true);

  logger.locatorFallback(taskId, 'step4', '开始菜单按钮', 'UIA', 'VLM', 'UIA 未找到元素');

  // 模拟截图
  logger.screenshot(taskId, 'step5', '/tmp/screenshot-001.png', 276);

  // 任务结束
  logger.taskEnd(taskId, true, steps.length, steps.length);
  metrics.recordTask(true, 4500);

  console.log('\n════════════════════════════════════════');
  console.log('测试完成！上方是 JSON Lines 格式日志');
  console.log('════════════════════════════════════════\n');

  // 输出 metrics 报告
  console.log(metrics.report());
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

testObservability().catch(console.error);
