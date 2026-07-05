#!/usr/bin/env tsx
/**
 * OpenOxygen Phase 2 Demo
 *
 * 展示集成能力：
 * 1. 浏览器自动化：打开网页 → 搜索 → 截图
 * 2. 文件系统：搜索项目文件 → 统计分析
 * 3. 记忆系统：存储任务上下文 → 跨会话回忆
 */

import { PlaywrightController } from "../src/browser/controller";
import { FileSystemManager } from "../src/fs/manager";
import { OxygenMemo } from "../src/memory/engine";
import * as path from "path";
import * as fs from "fs/promises";

async function main() {
  console.log("OpenOxygen Phase 2 - 集成 Demo");
  console.log("═".repeat(60));

  const startTime = Date.now();

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Part 1: 记忆系统 - 存储任务上下文
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log("\nPart 1: 记忆系统初始化");
  console.log("─".repeat(60));

  const memoryPath = path.join(process.cwd(), "output", "demo_memory");
  await fs.mkdir(memoryPath, { recursive: true });

  const memory = new OxygenMemo(memoryPath, 5);

  // 写入任务背景
  const taskId = await memory.writePage(
    "Phase 2 Demo 任务：验证浏览器、文件系统、记忆系统的集成能力",
    "Demo任务背景",
    "task",
  );
  console.log(`  ✓ 创建记忆页: ${taskId}`);

  // 写入项目信息
  const projectId = await memory.writePage(
    "OpenOxygen Next - Computer Use Agent Framework\n" +
      "技术栈: TypeScript + Rust + Playwright + Ollama\n" +
      "核心模块: LLM Gateway, Browser, FileSystem, Memory, GUI Control",
    "OpenOxygen项目",
    "core",
  );
  console.log(`  ✓ 创建记忆页: ${projectId}`);

  // 创建指针关联
  memory.createPointer(taskId, projectId, "相关项目");
  console.log(`  ✓ 创建指针: ${taskId} → ${projectId}`);

  const memStats = memory.getStats();
  console.log(
    `  ✓ 记忆统计: ${memStats.total_pages} 页, TLB 命中率 ${memStats.tlb_hit_rate}`,
  );

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Part 2: 文件系统 - 搜索项目文件
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log("\nPart 2: 文件系统分析");
  console.log("─".repeat(60));

  const fsManager = new FileSystemManager();

  // 搜索所有 TypeScript 文件
  const tsFiles = await fsManager.search(path.join(process.cwd(), "src"), {
    pattern: "**/*.ts",
    excludeDirs: ["node_modules", "dist", "build"],
  });
  console.log(`  ✓ 发现 TypeScript 文件: ${tsFiles.length} 个`);

  // 统计各目录文件数
  const dirStats = new Map<string, number>();
  for (const file of tsFiles) {
    const dir = path.dirname(file.path).split(path.sep).slice(-1)[0];
    dirStats.set(dir, (dirStats.get(dir) || 0) + 1);
  }

  console.log("  ✓ 目录统计:");
  for (const [dir, count] of Array.from(dirStats.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)) {
    console.log(`    - ${dir}: ${count} 文件`);
  }

  // 搜索代码中的 TODO/FIXME
  const todos = await fsManager.searchContent(
    path.join(process.cwd(), "src"),
    /TODO|FIXME/i,
  );
  console.log(`  ✓ 发现 TODO/FIXME: ${todos.length} 处`);

  // 将文件系统分析结果存入记忆
  const fsAnalysisId = await memory.writePage(
    `文件系统分析结果:\n` +
      `- TypeScript 文件: ${tsFiles.length} 个\n` +
      `- TODO/FIXME: ${todos.length} 处\n` +
      `- 主要目录: ${Array.from(dirStats.keys()).join(", ")}`,
    "文件系统分析",
    "knowledge",
  );
  console.log(`  ✓ 分析结果存入记忆: ${fsAnalysisId}`);
  memory.createPointer(taskId, fsAnalysisId, "分析结果");

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Part 3: 浏览器自动化 - 访问 GitHub
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log("\nPart 3: 浏览器自动化");
  console.log("─".repeat(60));

  const browser = new PlaywrightController({ headless: true });

  try {
    console.log("  ⏳ 启动 Chromium...");
    await browser.launch();
    console.log("  ✓ 浏览器已启动");

    // 访问 GitHub
    console.log("  ⏳ 导航到 GitHub...");
    const navResult = await browser.navigate("https://github.com/trending");
    console.log(`  ✓ 页面加载成功: ${navResult.title}`);

    // 等待页面加载
    await browser.waitForSelector("article.Box-row", 5000);

    // 获取页面信息
    const pageSource = await browser.getPageSource();
    console.log(`  ✓ 页面链接数: ${pageSource.links.length}`);

    // 截图
    console.log("  ⏳ 截图...");
    const screenshot = await browser.screenshot(true);
    const screenshotPath = path.join(
      process.cwd(),
      "output",
      "demo_github_trending.png",
    );
    await fs.writeFile(screenshotPath, Buffer.from(screenshot, "base64"));
    console.log(`  ✓ 截图保存: ${screenshotPath}`);

    // 将浏览器操作结果存入记忆
    const browserResultId = await memory.writePage(
      `浏览器自动化结果:\n` +
        `- 目标页面: ${navResult.url}\n` +
        `- 页面标题: ${navResult.title}\n` +
        `- 链接数: ${pageSource.links.length}\n` +
        `- 截图: ${screenshotPath}`,
      "浏览器操作结果",
      "history",
    );
    console.log(`  ✓ 操作结果存入记忆: ${browserResultId}`);
    memory.createPointer(taskId, browserResultId, "浏览器操作");
  } catch (error) {
    console.error(
      "  ✗ 浏览器操作失败:",
      error instanceof Error ? error.message : error,
    );
  } finally {
    await browser.close();
    console.log("  ✓ 浏览器已关闭");
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Part 4: 记忆检索 - 跨会话回忆
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log("\nPart 4: 记忆检索与关联");
  console.log("─".repeat(60));

  // 加载任务页
  const taskPage = memory.loadPage(taskId);
  if (taskPage) {
    console.log(`  ✓ 加载任务: ${taskPage.label}`);

    // 获取关联指针
    const pointers = memory.getPointers(taskId);
    console.log(`  ✓ 关联指针: ${Object.keys(pointers).length} 个`);
    for (const [label, targetId] of Object.entries(pointers)) {
      const target = memory.loadPage(targetId);
      if (target) {
        console.log(`    - ${label} → ${target.label} (${target.category})`);
      }
    }

    // 语义预取
    const prefetched = memory.prefetchPages(taskId, 3);
    console.log(`  ✓ 语义预取: ${prefetched.length} 个页面`);
    for (const pageId of prefetched) {
      const page = memory.loadPage(pageId);
      if (page) {
        console.log(`    - ${page.label} (访问 ${page.access_count} 次)`);
      }
    }
  }

  // 获取根索引
  const rootIndex = memory.getRootIndex();
  console.log("  ✓ 根索引:");
  for (const [key, info] of Object.entries(rootIndex)) {
    console.log(`    - ${info.name}: ${info.page_count} 页`);
  }

  // 最终统计
  const finalStats = memory.getStats();
  console.log(`  ✓ 最终统计:`);
  console.log(`    - 总页数: ${finalStats.total_pages}`);
  console.log(`    - 读取次数: ${finalStats.total_reads}`);
  console.log(`    - 写入次数: ${finalStats.total_writes}`);
  console.log(`    - TLB 命中率: ${finalStats.tlb_hit_rate}`);
  console.log(`    - 热点页数: ${finalStats.hot_pages}`);

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 总结
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log("\n" + "═".repeat(60));
  console.log("Phase 2 Demo 完成");
  console.log("═".repeat(60));
  console.log(`  耗时: ${duration}s`);
  console.log(`  文件: ${tsFiles.length} 个 TS 文件`);
  console.log(
    `  记忆: ${finalStats.total_pages} 页, ${finalStats.tlb_hit_rate} 命中`,
  );
  console.log(`  截图: output/demo_github_trending.png`);
  console.log("═".repeat(60));
}

main().catch(console.error);
