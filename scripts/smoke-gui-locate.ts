#!/usr/bin/env tsx
/**
 * 冒烟测试：GUI 目标定位粘合层（方案 A 的核心闭环）
 *
 * 只打这次改的粘合层，绕开 LLM planner，把变量降到最少：
 *   1. 截图    —— windows.ts::screenshot（PowerShell + GDI）
 *   2. UIA 定位 —— windows.ts::locateByDescription（第 1 级，零 VLM token）
 *   3. 视觉定位 —— vision::findElement（第 2 级，Ollama VLM 兜底）
 *
 * 用法：
 *   npx tsx scripts/smoke-gui-locate.ts "记事本"
 *   npx tsx scripts/smoke-gui-locate.ts "关闭按钮"
 *
 * 不传参数时用默认目标 "记事本"。
 *
 * 判读：
 *   - [1级命中]  说明 UIA 路径通，最理想（准、快、不烧 token）
 *   - [2级命中]  说明 UIA 没命中、走了 VLM 兜底，注意看坐标准不准
 *   - [都没命中] 目标在当前屏幕上不存在，或 VLM 没找到 —— 换个屏幕上真实可见的目标再试
 */

import { WindowsGuiController } from "../src/gui/windows";
import { saveScreenshot, findElement, VISION_MODELS } from "../src/execution/vision";

async function main() {
  const target = process.argv[2] || "记事本";

  console.log("OpenOxygen 冒烟测试 - GUI 目标定位粘合层");
  console.log("═".repeat(60));
  console.log(`  目标描述: "${target}"`);
  console.log(`  VLM 模型:  ${VISION_MODELS.qwen3vlSmall.model} @ ${VISION_MODELS.qwen3vlSmall.baseUrl}`);
  console.log("═".repeat(60));

  const gui = new WindowsGuiController();

  // ── 第 1 级：UIA 系统级定位 ─────────────────────────────
  console.log("\n[第 1 级] UIA 系统级定位（find_element → centerOfElement）");
  console.log("─".repeat(60));

  let uiaCoords: { x: number; y: number } | null = null;
  const uiaStart = Date.now();
  try {
    uiaCoords = await gui.locateByDescription(target);
    const uiaMs = Date.now() - uiaStart;
    if (uiaCoords) {
      console.log(`  ✓ [1级命中] 坐标 (${uiaCoords.x}, ${uiaCoords.y})  耗时 ${uiaMs}ms`);
    } else {
      console.log(`  · UIA 未命中（元素不在 UIA 树中，或只有 ProcessId 无坐标）  耗时 ${uiaMs}ms`);
    }
  } catch (err: any) {
    console.log(`  ✗ UIA 定位异常: ${err?.message ?? err}`);
  }

  // ── 第 2 级：视觉定位兜底 ───────────────────────────────
  console.log("\n[第 2 级] 视觉定位兜底（screenshot → VLM findElement → bounds 中心）");
  console.log("─".repeat(60));

  let visionCoords: { x: number; y: number } | null = null;
  const visStart = Date.now();
  try {
    console.log("  ⏳ 截图中...");
    const base64 = await gui.screenshot();
    if (!base64) {
      console.log("  ✗ 截图返回空");
    } else {
      console.log(`  ✓ 截图成功 (${Math.round(base64.length / 1024)} KB base64)`);
      const imagePath = await saveScreenshot(base64);
      console.log(`  ✓ 截图落盘: ${imagePath}`);

      console.log("  ⏳ 调用 VLM 定位（首次可能较慢，模型冷启动）...");
      const element = await findElement(imagePath, target);
      const visMs = Date.now() - visStart;

      if (element && element.bounds) {
        const { x, y, width, height } = element.bounds;
        visionCoords = { x: Math.round(x + width / 2), y: Math.round(y + height / 2) };
        console.log(`  ✓ [2级命中] VLM 返回元素:`);
        console.log(`      type=${element.type ?? "?"}  text="${element.text ?? ""}"`);
        console.log(`      bounds=(x=${x}, y=${y}, w=${width}, h=${height})`);
        console.log(`      中心点 (${visionCoords.x}, ${visionCoords.y})  耗时 ${visMs}ms`);
      } else {
        console.log(`  · VLM 未返回可用 bounds（没找到，或输出格式不含坐标）  耗时 ${visMs}ms`);
      }
    }
  } catch (err: any) {
    console.log(`  ✗ 视觉定位异常: ${err?.message ?? err}`);
  }

  // ── 结论 ────────────────────────────────────────────────
  console.log("\n" + "═".repeat(60));
  console.log("结论");
  console.log("═".repeat(60));

  const finalCoords = uiaCoords ?? visionCoords;
  const source = uiaCoords ? "UIA（第1级）" : visionCoords ? "VLM（第2级）" : "无";

  if (finalCoords) {
    console.log(`  ✓ resolveGuiTarget 会返回: (${finalCoords.x}, ${finalCoords.y})`);
    console.log(`    来源: ${source}`);
    console.log(`\n  下一步（可选）：确认坐标是否真的落在 "${target}" 上。`);
    console.log(`    可手动核对，或让 GUI 把鼠标移过去看看：`);
    console.log(`    → 在 REPL 里 new WindowsGuiController().move_mouse(${finalCoords.x}, ${finalCoords.y})`);
  } else {
    console.log(`  ✗ 两级都没定位到 "${target}"。`);
    console.log(`    排查方向：`);
    console.log(`    1. 该目标此刻是否真的在屏幕上可见？（换个明显可见的目标重试）`);
    console.log(`    2. VLM 那一级：Ollama 是否在跑？模型 ${VISION_MODELS.qwen3vlSmall.model} 是否已 pull？`);
    console.log(`       检查: ollama list  /  ollama pull ${VISION_MODELS.qwen3vlSmall.model}`);
  }
  console.log("═".repeat(60));
}

main().catch((err) => {
  console.error("冒烟测试崩溃:", err instanceof Error ? err.stack : err);
  process.exit(1);
});
