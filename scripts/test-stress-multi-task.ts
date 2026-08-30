#!/usr/bin/env tsx
/**
 * 多任务压测（以身入局模式）：手动构造 Plan，验证执行层泛化能力
 *
 * 不依赖 LLM/API Key——Plan 由 AI 编码搭档（小氧）直接手写，
 * 用于暴露 Executor → GUI/CLI/Browser 各链路的真实短板。
 *
 * 任务：
 *   calc    计算器：Win+R 启动 → 键盘输入算式 1234+5678 → 预期显示 6912
 *   files   文件操作：记事本输入 → Ctrl+S 保存到 output/stress-test.txt → CLI 验证落盘
 *   browser 浏览器：Playwright 导航 DuckDuckGo → 输入搜索词 → 点击搜索
 *
 * 用法：
 *   npx tsx scripts/test-stress-multi-task.ts --task calc
 *   npx tsx scripts/test-stress-multi-task.ts --task all
 */

import * as path from 'path';
import { PlanExecutor } from '../src/orchestrator/executor';
import { RobotGuiController } from '../src/gui/robot';
import { NodeCliExecutor } from '../src/cli/executor';
import { PlaywrightController } from '../src/browser/controller';
import { SessionContext } from '../src/orchestrator/context';
import type { PlanStep, TaskPlan } from '../src/orchestrator/planner';

// ── 步骤构造辅助（减少样板） ──────────────────────────────

let seq = 0;
function step(
  type: PlanStep['type'],
  description: string,
  params: PlanStep['params'],
  dependencies: string[],
  opts: Partial<Pick<PlanStep, 'timeoutMs' | 'captureScreenshot'>> = {}
): PlanStep {
  seq += 1;
  return {
    id: `s${seq}`,
    type,
    description,
    params,
    dependencies,
    retryConfig: { maxRetries: 1, backoffMs: 500 },
    timeoutMs: opts.timeoutMs ?? (type.startsWith('cli_') ? 60000 : 30000),
    captureScreenshot: opts.captureScreenshot ?? false,
  };
}

// ── 任务 1：计算器（纯 GUI 键盘流） ───────────────────────

function buildCalcPlan(): TaskPlan {
  seq = 0;
  const s1 = step('gui_click', '点击桌面空白处确保无焦点', { target: { x: 500, y: 500 } }, []);
  const s2 = step('wait', '等待焦点稳定', { durationMs: 500 }, [s1.id]);
  const s3 = step('gui_type', 'Win+R 打开运行对话框', { text: '#r' }, [s2.id]);
  const s4 = step('wait', '等待运行对话框出现', { durationMs: 800 }, [s3.id]);
  const s5 = step('gui_type', '输入 calc', { text: 'calc' }, [s4.id]);
  const s6 = step('gui_type', '回车启动计算器', { text: '{ENTER}' }, [s5.id]);
  const s7 = step('wait', '等待计算器完全加载', { durationMs: 2500 }, [s6.id]);
  const s8 = step('gui_type', '输入被加数 1234', { text: '1234' }, [s7.id]);
  const s9 = step('gui_type', '输入加号', { text: '+' }, [s8.id]);
  const s10 = step('gui_type', '输入加数 5678', { text: '5678' }, [s9.id]);
  const s11 = step('gui_type', '回车求和', { text: '{ENTER}' }, [s10.id]);
  const s12 = step('wait', '等待结果显示', { durationMs: 500 }, [s11.id]);
  const s13 = step('gui_screenshot', '截图记录结果（预期 6912，人工核对）', {}, [s12.id], {
    captureScreenshot: true,
  });

  return {
    taskId: `stress_calc_${Date.now()}`,
    version: '2.0',
    description: '打开计算器并计算 1234+5678（预期 6912）',
    steps: [s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11, s12, s13],
    dependencies: new Map(),
  };
}

// ── 任务 2：文件操作（GUI + CLI 混合流） ─────────────────

function buildFilesPlan(): TaskPlan {
  seq = 0;
  const outDir = path.resolve(process.cwd(), 'output');
  const outFile = path.join(outDir, 'stress-test.txt');

  const s1 = step(
    'cli_execute',
    '确保 output 目录存在',
    {
      command: `powershell -NoProfile -Command "New-Item -ItemType Directory -Force -Path '${outDir}' | Out-Null"`,
      timeout: 15000,
    },
    []
  );
  const s2 = step('gui_type', 'Win+R 打开运行对话框', { text: '#r' }, [s1.id]);
  const s3 = step('wait', '等待运行对话框出现', { durationMs: 800 }, [s2.id]);
  const s4 = step('gui_type', '输入 notepad', { text: 'notepad' }, [s3.id]);
  const s5 = step('gui_type', '回车启动记事本', { text: '{ENTER}' }, [s4.id]);
  const s6 = step('wait', '等待记事本加载', { durationMs: 2000 }, [s5.id]);
  const s7 = step('gui_type', '输入文件内容', { text: 'OpenOxygen stress test - files task' }, [s6.id]);
  const s8 = step('gui_type', 'Ctrl+S 触发保存对话框', { text: '^s' }, [s7.id]);
  const s9 = step('wait', '等待保存对话框就绪', { durationMs: 1500 }, [s8.id]);
  const s10 = step('gui_type', '输入完整保存路径（文件名框默认聚焦）', { text: outFile }, [s9.id]);
  const s11 = step('gui_type', '回车确认保存', { text: '{ENTER}' }, [s10.id]);
  const s12 = step('wait', '等待写入完成', { durationMs: 1000 }, [s11.id]);
  const s13 = step(
    'cli_execute',
    'CLI 验证文件已落盘（预期输出 True）',
    {
      command: `powershell -NoProfile -Command "Test-Path '${outFile}'"`,
      captureOutput: true,
      timeout: 15000,
    },
    [s12.id]
  );
  const s14 = step('gui_type', 'Alt+F4 关闭记事本', { text: '%{F4}' }, [s13.id]);

  return {
    taskId: `stress_files_${Date.now()}`,
    version: '2.0',
    description: `记事本写入并保存到 ${outFile}，CLI 验证`,
    steps: [s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11, s12, s13, s14],
    dependencies: new Map(),
  };
}

// ── 任务 3：浏览器（Playwright 链路） ────────────────────

function buildBrowserPlan(): TaskPlan {
  seq = 0;
  const b1 = step('browser_navigate', '打开 DuckDuckGo HTML 版', { url: 'https://html.duckduckgo.com/html/' }, [], {
    timeoutMs: 45000,
  });
  const b2 = step('wait', '等待页面渲染', { durationMs: 1000 }, [b1.id]);
  const b3 = step(
    'browser_type',
    '在搜索框输入关键词',
    { selector: "input[name='q']", text: 'OpenOxygen Computer Use Agent' },
    [b2.id],
    { timeoutMs: 15000 }
  );
  const b4 = step('browser_click', '点击搜索按钮', { selector: "input[type='submit']" }, [b3.id], {
    timeoutMs: 15000,
  });
  const b5 = step('wait', '等待结果页加载', { durationMs: 2000 }, [b4.id]);

  return {
    taskId: `stress_browser_${Date.now()}`,
    version: '2.0',
    description: '浏览器搜索 OpenOxygen Computer Use Agent',
    steps: [b1, b2, b3, b4, b5],
    dependencies: new Map(),
  };
}

// ── 执行器 ────────────────────────────────────────────────

async function runPlan(plan: TaskPlan): Promise<boolean> {
  console.log(`\n[计划概览] ${plan.description}`);
  console.log('─'.repeat(60));
  plan.steps.forEach((s, i) => console.log(`  ${i + 1}. [${s.type}] ${s.description}`));

  console.log('\n  ⚠️  即将执行真实操作，按 Ctrl+C 可中止。等待 3 秒...');
  await new Promise((r) => setTimeout(r, 3000));

  const executor = new PlanExecutor({
    guiController: new RobotGuiController(),
    cliExecutor: new NodeCliExecutor(),
    browserController: new PlaywrightController(),
    maxRetries: 1,
    enableReflection: false,
  });
  const session = new SessionContext();
  const ctx = {
    taskId: plan.taskId,
    plan,
    request: { description: plan.description },
    startTime: Date.now(),
    currentStep: 0,
    results: [] as any[],
  };

  try {
    const results = await executor.execute(ctx as any, session);

    console.log('\n[执行结果]');
    console.log('─'.repeat(60));
    results.forEach((r: any, i: number) => {
      const st = r.success ? '✓' : '✗';
      console.log(`  ${st} ${i + 1}. ${plan.steps[i]?.description ?? r.stepId} (${r.durationMs}ms)`);
      if (r.error) console.log(`     错误: ${r.error}`);
      if (plan.steps[i]?.type === 'cli_execute' && r.output?.stdout != null) {
        const out = String(r.output.stdout).trim();
        if (out) console.log(`     输出: ${out}`);
      }
    });

    const ok = results.filter((r: any) => r.success).length;
    const totalMs = Date.now() - ctx.startTime;
    console.log('\n' + '═'.repeat(60));
    console.log(`${plan.description.slice(0, 30)}…: ${ok}/${results.length} 成功，${totalMs}ms`);
    console.log('═'.repeat(60));
    return ok === results.length;
  } catch (error: any) {
    console.log(`\n✗ 执行失败: ${error?.message ?? error}`);
    return false;
  }
}

async function main() {
  const argIdx = process.argv.indexOf('--task');
  const task = argIdx >= 0 ? process.argv[argIdx + 1] : 'all';

  console.log('OpenOxygen 多任务压测（以身入局：AI 手写 Plan）');
  console.log('═'.repeat(60));

  const tasks: Record<string, () => TaskPlan> = {
    calc: buildCalcPlan,
    files: buildFilesPlan,
    browser: buildBrowserPlan,
  };

  const selected =
    task === 'all' ? Object.keys(tasks) : [task];

  let allOk = true;
  for (const name of selected) {
    const builder = tasks[name];
    if (!builder) {
      console.log(`未知任务: ${name}（可选: ${Object.keys(tasks).join(' / ')} / all）`);
      process.exit(1);
    }
    console.log(`\n${'■'.repeat(60)}\n■ 任务: ${name}\n${'■'.repeat(60)}`);
    const ok = await runPlan(builder());
    allOk = allOk && ok;
  }

  console.log('\n[总结]');
  console.log(allOk ? '🎉 全部任务通过。请实机核对：计算器显示 6912、文件已落盘、搜索结果页已打开。' : '⚠️ 存在失败步骤，见上方日志。失败点即执行层待补强的短板。');
  process.exit(allOk ? 0 : 1);
}

main().catch(console.error);
