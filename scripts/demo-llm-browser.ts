#!/usr/bin/env tsx
/**
 * OpenOxygen Phase 2 - LLM 驱动的浏览器自动化 Demo
 *
 * 展示能力：
 * 1. 自然语言控制浏览器
 * 2. 智能页面理解和交互
 * 3. 记忆系统记录浏览历史
 * 4. 多步骤任务自动规划
 */

import { PlaywrightController } from "../src/browser/controller";
import { OxygenMemo } from "../src/memory/engine";
import { LLMGateway } from "../src/llm/gateway";
import * as path from "path";
import * as fs from "fs/promises";

interface BrowserAction {
  type: "navigate" | "click" | "type" | "screenshot" | "extract";
  target?: string;
  value?: string;
  selector?: string;
}

/**
 * 简单的 LLM 驱动浏览器控制器
 */
class LLMBrowserAgent {
  private browser: PlaywrightController;
  private memory: OxygenMemo;
  private llm: LLMGateway;

  constructor(
    browser: PlaywrightController,
    memory: OxygenMemo,
    llm: LLMGateway,
  ) {
    this.browser = browser;
    this.memory = memory;
    this.llm = llm;
  }

  /**
   * 执行自然语言浏览器任务
   */
  async execute(task: string): Promise<string> {
    console.log(`\n任务: ${task}`);
    console.log("─".repeat(60));

    // 0. 确保浏览器已启动
    await this.browser.launch();

    // 1. 使用 LLM 将任务分解为浏览器操作
    const actions = await this.planActions(task);

    console.log(`\n规划了 ${actions.length} 个操作:`);
    actions.forEach((action, i) => {
      console.log(
        `  ${i + 1}. ${action.type} ${action.target || action.selector || ""}`,
      );
    });

    // 2. 执行每个操作
    const results: string[] = [];
    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];
      console.log(`\n⏳ 执行操作 ${i + 1}/${actions.length}: ${action.type}`);

      try {
        const result = await this.executeAction(action);
        results.push(result);
        console.log(`  ✓ ${result}`);

        // 短暂延迟，让页面加载
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch (error: any) {
        const errorMsg = `操作失败: ${error.message}`;
        console.log(`  ✗ ${errorMsg}`);
        results.push(errorMsg);
      }
    }

    // 3. 保存到记忆系统
    const sessionId = await this.memory.writePage(
      `任务: ${task}\n\n操作记录:\n${results.map((r, i) => `${i + 1}. ${r}`).join("\n")}`,
      `浏览器任务-${Date.now()}`,
      "history",
    );

    console.log(`\n会话已保存到记忆: ${sessionId}`);

    return results.join("\n");
  }

  /**
   * 使用 LLM 规划浏览器操作序列
   */
  private async planActions(task: string): Promise<BrowserAction[]> {
    const prompt = `你是一个浏览器自动化助手。将以下任务分解为具体的浏览器操作序列。

任务: ${task}

可用操作类型:
- navigate: 导航到 URL (需要 target: url)
- click: 点击元素 (需要 selector: CSS选择器)
- type: 输入文本 (需要 selector: CSS选择器, value: 文本内容)
- screenshot: 截图
- extract: 提取页面信息

请返回 JSON 格式的操作数组，例如:
[
  {"type": "navigate", "target": "https://github.com"},
  {"type": "type", "selector": "input[name='q']", "value": "openai"},
  {"type": "click", "selector": "button[type='submit']"},
  {"type": "screenshot"}
]

只返回 JSON 数组，不要其他内容:`;

    const response = await this.llm.complete({
      prompt,
      temperature: 0.1,
    });

    // 提取 JSON
    const jsonMatch = response.content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      throw new Error("LLM 未返回有效的操作序列");
    }

    return JSON.parse(jsonMatch[0]);
  }

  /**
   * 执行单个浏览器操作
   */
  private async executeAction(action: BrowserAction): Promise<string> {
    switch (action.type) {
      case "navigate": {
        if (!action.target) throw new Error("navigate 需要 target URL");
        const result = await this.browser.navigate(action.target);
        return `导航到 ${action.target}, 页面标题: ${result.title}`;
      }

      case "click":
        if (!action.selector) throw new Error("click 需要 selector");
        await this.browser.click(action.selector);
        return `点击了 ${action.selector}`;

      case "type":
        if (!action.selector || !action.value) {
          throw new Error("type 需要 selector 和 value");
        }
        await this.browser.typeText(action.selector, action.value);
        return `在 ${action.selector} 输入了 "${action.value}"`;

      case "screenshot": {
        const screenshotPath = path.join(
          process.cwd(),
          "output",
          `llm-browser-${Date.now()}.png`,
        );
        await fs.mkdir(path.dirname(screenshotPath), { recursive: true });
        const base64 = await this.browser.screenshot(false);
        await fs.writeFile(screenshotPath, Buffer.from(base64, "base64"));
        return `截图保存到 ${screenshotPath}`;
      }

      case "extract": {
        const title = await this.browser.getTitle();
        const url = this.browser.getCurrentUrl();
        return `提取页面信息: 标题="${title}", URL=${url}`;
      }

      default:
        throw new Error(`未知操作类型: ${action.type}`);
    }
  }
}

async function main() {
  console.log("OpenOxygen Phase 2 - LLM 驱动浏览器自动化");
  console.log("═".repeat(60));

  const startTime = Date.now();

  // 初始化组件
  const memoryPath = path.join(process.cwd(), "output", "llm_browser_memory");
  await fs.mkdir(memoryPath, { recursive: true });

  const browser = new PlaywrightController({ headless: false }); // 非 headless 模式，可以看到操作过程
  const memory = new OxygenMemo(memoryPath, 5);
  const llm = new LLMGateway({
    provider: "ollama",
    baseURL: "http://localhost:11434",
  });

  const agent = new LLMBrowserAgent(browser, memory, llm);

  // 测试任务
  const tasks = [
    // 任务 1: 搜索 GitHub 仓库
    '打开 GitHub，搜索 "playwright typescript"，并截图',

    // 任务 2: 访问新闻网站
    // '访问 https://news.ycombinator.com，截图首页',
  ];

  try {
    for (let i = 0; i < tasks.length; i++) {
      console.log(`\n${"=".repeat(60)}`);
      console.log(`任务 ${i + 1}/${tasks.length}`);
      console.log("=".repeat(60));

      await agent.execute(tasks[i]);

      // 任务间延迟
      if (i < tasks.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    // 显示记忆统计
    console.log("\n" + "═".repeat(60));
    console.log("记忆系统统计");
    console.log("─".repeat(60));

    const stats = memory.getStats();
    console.log(`  总页数: ${stats.total_pages}`);
    console.log(`  读取次数: ${stats.total_reads}`);
    console.log(`  写入次数: ${stats.total_writes}`);
    console.log(`  TLB 命中率: ${stats.tlb_hit_rate}`);

    const rootIndex = memory.getRootIndex();
    console.log("\n  分类统计:");
    for (const [key, info] of Object.entries(rootIndex)) {
      console.log(`    - ${info.name}: ${info.page_count} 页`);
    }
  } catch (error: any) {
    console.error("\n执行失败:", error.message);
  } finally {
    await browser.close();

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log("\n" + "═".repeat(60));
    console.log(`Demo 完成，耗时 ${elapsed}s`);
    console.log("═".repeat(60));
  }
}

main().catch(console.error);
