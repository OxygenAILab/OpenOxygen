#!/usr/bin/env tsx
/**
 * 端到端测试：Planner → Executor → GUI
 *
 * 这是整个 Agent 的核心链路测试：
 * 1. 用户输入自然语言任务
 * 2. Planner (LLM) 生成 PlanStep[]
 * 3. Executor 执行每个 step
 * 4. GUI 控制器完成实际操作
 *
 * 用法：
 *   npx tsx scripts/test-planner-e2e.ts
 *   npx tsx scripts/test-planner-e2e.ts "打开记事本，输入 Hello World"
 */

import { generatePlan } from '../src/orchestrator/simple-planner';
import { PlanExecutor } from '../src/orchestrator/executor';
import { WindowsGuiController } from '../src/gui/windows';
import { SessionContext } from '../src/orchestrator/context';
import { metrics } from '../src/observability';

async function main() {
  const taskDescription = process.argv[2] || '打开记事本';

  console.log('OpenOxygen 端到端测试 - Planner → Executor → GUI');
  console.log('═'.repeat(60));
  console.log(`  任务: "${taskDescription}"`);
  console.log('═'.repeat(60));

  // ── 第 1 步: 生成计划 ────────────────────────────────────
  console.log('\n[第 1 步] Planner 生成执行计划');
  console.log('─'.repeat(60));

  let plan;
  try {
    const startPlan = Date.now();
    plan = await generatePlan(taskDescription, 'gui');
    const planMs = Date.now() - startPlan;

    console.log(`  ✓ 计划生成成功（耗时 ${planMs}ms）`);
    console.log(`  步骤数: ${plan.steps.length}`);
    console.log('\n  步骤列表:');
    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      console.log(`    ${i + 1}. [${step.type}] ${step.description}`);
      if (step.params.target) {
        console.log(`       → 目标: ${step.params.target}`);
      }
      if (step.dependencies.length > 0) {
        console.log(`       → 依赖: ${step.dependencies.join(', ')}`);
      }
    }
  } catch (error: any) {
    console.log(`  ✗ 计划生成失败: ${error?.message ?? error}`);
    console.log('\n可能原因:');
    console.log('  1. Ollama 未运行（运行 `ollama serve`）');
    console.log('  2. qwen2.5:7b 未安装（运行 `ollama pull qwen2.5:7b`）');
    console.log('  3. LLM 未返回有效 JSON');
    process.exit(1);
  }

  // ── 第 2 步: 执行计划 ────────────────────────────────────
  console.log('\n[第 2 步] Executor 执行计划');
  console.log('─'.repeat(60));
  console.log('  ⚠️  即将执行真实 GUI 操作，按 Ctrl+C 可中止');
  console.log('  等待 3 秒...\n');

  await new Promise((resolve) => setTimeout(resolve, 3000));

  const gui = new WindowsGuiController();
  const executor = new PlanExecutor({
    guiController: gui,
    maxRetries: 1,
    enableReflection: false,
  });

  const session = new SessionContext();
  const executionContext = {
    taskId: plan.taskId,
    plan,
    request: { description: taskDescription },
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

    console.log('\n' + '═'.repeat(60));
    console.log(`任务完成: ${successCount}/${results.length} 步骤成功`);
    console.log('═'.repeat(60));

    if (failCount > 0) {
      console.log(`\n⚠️  ${failCount} 个步骤失败，请检查:
  1. 目标元素是否存在（如"记事本"是否真的在屏幕上）
  2. UIA 定位是否准确
  3. 步骤之间是否需要更多等待时间`);
      process.exit(1);
    }

    console.log('\n🎉 完整链路验证通过！Planner → Executor → GUI 闭环可用。');

    // 输出 metrics 报告
    console.log('\n' + metrics.report());
  } catch (error: any) {
    console.log(`\n✗ 执行失败: ${error?.message ?? error}`);
    process.exit(1);
  }
}

main().catch(console.error);
