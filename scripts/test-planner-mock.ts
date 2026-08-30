/**
 * 验证 SimplePlanner 全链路(指向本地 mock-brain 服务器,无需 API Key)
 *
 * 前置: mock-brain-server 已在 localhost:11434 运行
 * 用法: npx tsx scripts/test-planner-mock.ts "任务描述"
 */

process.env.OPENOXYGEN_PLANNER_BASE_URL =
  process.env.OPENOXYGEN_PLANNER_BASE_URL || 'http://127.0.0.1:11434/v1';
process.env.OPENOXYGEN_PLANNER_API_KEY =
  process.env.OPENOXYGEN_PLANNER_API_KEY || 'mock';
process.env.OPENOXYGEN_PLANNER_MODEL =
  process.env.OPENOXYGEN_PLANNER_MODEL || 'mock-brain';

import { generatePlan } from '../src/orchestrator/simple-planner';

async function main(): Promise<void> {
  const description = process.argv[2] || '打开记事本并输入 hello world';

  console.log(`[test] 任务: ${description}`);
  console.log('[test] 调用 generatePlan (等待 mock-brain 大脑作答)...');

  const plan = await generatePlan(description);

  console.log('\n[test] ✅ 计划生成成功:');
  console.log(`  taskId: ${plan.taskId}`);
  console.log(`  version: ${plan.version}`);
  console.log(`  steps: ${plan.steps.length}`);

  for (const step of plan.steps) {
    console.log(
      `    - ${step.id} [${step.type}] ${step.description} deps=[${step.dependencies.join(',')}]`
    );
  }

  // 基本结构断言
  if (!plan.steps.length) throw new Error('计划为空');
  const ids = new Set(plan.steps.map((s) => s.id));
  for (const step of plan.steps) {
    for (const dep of step.dependencies) {
      if (!ids.has(dep)) throw new Error(`${step.id} 依赖不存在的 ${dep}`);
    }
  }

  console.log('\n[test] ✅ 结构断言通过(依赖关系合法)');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('[test] ❌ 失败:', e instanceof Error ? e.message : e);
    process.exit(1);
  });
