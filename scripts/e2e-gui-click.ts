#!/usr/bin/env tsx
/**
 * 端到端测试：GUI 目标定位 + 鼠标移动/点击
 *
 * 验证链路：resolveGuiTarget → UIA/VLM 定位 → GUI 执行
 *
 * 用法：
 *   npx tsx scripts/e2e-gui-click.ts "Cherry Studio"
 *   npx tsx scripts/e2e-gui-click.ts "Cherry Studio" --click
 *
 * 默认只移动鼠标（安全），加 --click 参数会真实点击（请确认目标安全）。
 */

import { WindowsGuiController } from '../src/gui/windows';
import { saveScreenshot, findElement } from '../src/execution/vision';

async function main() {
  const target = process.argv[2] || 'Cherry Studio';
  const shouldClick = process.argv.includes('--click');

  console.log('OpenOxygen 端到端测试 - GUI 定位 + 执行');
  console.log('═'.repeat(60));
  console.log(`  目标: "${target}"`);
  console.log(`  模式: ${shouldClick ? '真实点击 ⚠️' : '试运行（仅移动鼠标）'}`);
  console.log('═'.repeat(60));

  const gui = new WindowsGuiController();

  // ── 定位目标（模拟 executor.ts::resolveGuiTarget 逻辑） ────
  console.log('\n[定位目标]');
  console.log('─'.repeat(60));

  let coords: { x: number; y: number } | null = null;
  let source = '';

  // 第 1 级：UIA
  try {
    console.log('  ⏳ 尝试 UIA 定位...');
    const uiaStart = Date.now();
    const uiaCoords = await gui.locateByDescription(target);
    const uiaMs = Date.now() - uiaStart;

    if (uiaCoords) {
      coords = uiaCoords;
      source = 'UIA（第1级）';
      console.log(`  ✓ UIA 命中: (${coords.x}, ${coords.y})  耗时 ${uiaMs}ms`);
    } else {
      console.log(`  · UIA 未命中  耗时 ${uiaMs}ms`);
    }
  } catch (err: any) {
    console.log(`  ✗ UIA 异常: ${err?.message ?? err}`);
  }

  // 第 2 级：视觉兜底（如果 UIA 没命中）
  if (!coords) {
    try {
      console.log('  ⏳ 尝试视觉定位兜底...');
      const visStart = Date.now();
      const base64 = await gui.screenshot();
      if (base64) {
        const imagePath = await saveScreenshot(base64);
        console.log(`  ✓ 截图落盘: ${imagePath}`);

        const element = await findElement(imagePath, target);
        const visMs = Date.now() - visStart;

        if (element && element.bounds) {
          const { x, y, width, height } = element.bounds;
          coords = { x: Math.round(x + width / 2), y: Math.round(y + height / 2) };
          source = 'VLM（第2级）';
          console.log(`  ✓ VLM 命中: (${coords.x}, ${coords.y})  耗时 ${visMs}ms`);
        } else {
          console.log(`  · VLM 未返回坐标  耗时 ${visMs}ms`);
        }
      }
    } catch (err: any) {
      console.log(`  ✗ 视觉定位异常: ${err?.message ?? err}`);
    }
  }

  if (!coords) {
    console.log('\n✗ 两级都没定位到目标');
    process.exit(1);
  }

  // ── 执行 GUI 动作 ──────────────────────────────────────
  console.log('\n[执行 GUI 动作]');
  console.log('─'.repeat(60));
  console.log(`  目标坐标: (${coords.x}, ${coords.y})`);
  console.log(`  来源: ${source}`);

  try {
    if (shouldClick) {
      console.log('  ⏳ 执行点击...');
      const result = await gui.click(coords.x, coords.y);
      if (result.success) {
        console.log(`  ✓ 点击成功`);
        console.log(`\n  ⚠️  已在坐标 (${coords.x}, ${coords.y}) 执行真实点击。`);
        console.log(`  请检查是否触发了预期的 UI 响应。`);
      } else {
        console.log(`  ✗ 点击失败: ${result.error}`);
        process.exit(1);
      }
    } else {
      const result = await gui.move_mouse(coords.x, coords.y);
      if (result.success) {
        console.log(`  ✓ 鼠标已移到目标位置`);
        console.log(`\n  请观察鼠标是否真的落在 "${target}" 上。`);
        console.log(`  如果位置准确，加 --click 参数可测试真实点击。`);
      } else {
        console.log(`  ✗ 移动鼠标失败: ${result.error}`);
        process.exit(1);
      }
    }
  } catch (err: any) {
    console.log(`  ✗ GUI 操作异常: ${err?.message ?? err}`);
    process.exit(1);
  }

  console.log('\n' + '═'.repeat(60));
  console.log(`测试完成${shouldClick ? '（已点击）' : '（未点击）'}`);
  console.log('═'.repeat(60));
}

main().catch(console.error);
