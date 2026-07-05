/**
 * OpenOxygen E2E Demo Script
 *
 * 测试完整 "打开记事本并输入 Hello" 流程。
 * 直接使用 LLMGateway + 原生 Node.js/PowerShell 实现，
 * 不依赖尚未完成的 NodeCliExecutor / WindowsGuiController。
 *
 * 运行: npx tsx scripts/demo.ts
 */

import { LLMGateway } from "../src/llm/gateway";
import { execSync, spawn } from "child_process";
import * as path from "path";
import * as fs from "fs";

// ============================================================
// 工具函数
// ============================================================

/** 项目根目录 */
const ROOT_DIR = path.resolve(__dirname, "..");
/** 输出目录 */
const OUTPUT_DIR = path.resolve(ROOT_DIR, "output");
/** 临时 PowerShell 脚本目录 */
const TMP_DIR = path.resolve(OUTPUT_DIR, ".tmp");

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 执行 PowerShell 命令（同步，返回 stdout）
 * 使用 Base64 编码避免转义问题
 */
function runPS(script: string): string {
  const fullScript = `$ProgressPreference = 'SilentlyContinue'\n${script}`;
  const base64 = Buffer.from(fullScript, "utf-16le").toString("base64");
  return execSync(
    `powershell -NoProfile -NonInteractive -EncodedCommand ${base64}`,
    { encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 }
  );
}

/**
 * 尝试聚焦 Notepad 窗口，然后发送按键
 */
function sendKeys(text: string): void {
  // SendKeys 特殊字符转义: +, ^, %, ~, (, ), {, }
  const escaped = text
    .replace(/\+/g, '{+}')
    .replace(/\^/g, '{^}')
    .replace(/%/g, '{%}')
    .replace(/~/g, '{~}')
    .replace(/\(/g, '{(}')
    .replace(/\)/g, '{)}')
    .replace(/\{/g, '{{}')
    .replace(/\}/g, '{}}')
    .replace(/'/g, "''");
  const script = `
    Add-Type -AssemblyName System.Windows.Forms
    $wsh = New-Object -ComObject WScript.Shell
    $wsh.AppActivate('Notepad') | Out-Null
    Start-Sleep -Milliseconds 300
    [System.Windows.Forms.SendKeys]::SendWait('${escaped}')
  `;
  runPS(script);
}

/**
 * 截取全屏截图，保存为 PNG
 */
function takeScreenshot(filepath: string): void {
  const script = `
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $screen = [System.Windows.Forms.Screen]::PrimaryScreen
    $bmp = New-Object System.Drawing.Bitmap($screen.Bounds.Width, $screen.Bounds.Height)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen(0, 0, 0, 0, $bmp.Size)
    $bmp.Save('${filepath.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose()
    $bmp.Dispose()
  `;
  runPS(script);
}

/** 打印分隔线 */
function separator(title: string): void {
  console.log(`\n${"=".repeat(50)}`);
  console.log(`  ${title}`);
  console.log(`${"=".repeat(50)}`);
}

/** 打印步骤信息 */
function logStep(stepNum: number, desc: string, action: string): void {
  console.log(`\n── Step ${stepNum} ────────────────────────────────────`);
  console.log(`  Action : ${action}`);
  console.log(`  Desc   : ${desc}`);
}

// ============================================================
// 核心流程
// ============================================================

interface PlanStep {
  stepNum: number;
  description: string;
  action: "cli_spawn" | "wait" | "gui_type" | "screenshot" | "cli_execute";
  command?: string;
  ms?: number;
  text?: string;
  filepath?: string;
}

interface ExecutionPlan {
  plan: string;
  steps: PlanStep[];
}

async function main(): Promise<void> {
  // ----------------------------------------------------------
  // 0. 环境准备
  // ----------------------------------------------------------
  separator("OpenOxygen E2E Demo");
  console.log("  Target : Open Notepad → Type 'Hello'");
  console.log("  Model  : qwen3:4B via Ollama (localhost:11434)");

  ensureDir(OUTPUT_DIR);
  ensureDir(TMP_DIR);

  // ----------------------------------------------------------
  // 1. 初始化 LLM Gateway
  // ----------------------------------------------------------
  separator("Step 1: Init LLM Gateway");

  const gateway = new LLMGateway({
    provider: "openai",
    apiKey: "ollama",
    baseUrl: "http://localhost:11434/v1",
    model: "aikid123/qwen3-coder:latest",
    temperature: 0.1,
  });

  console.log("  Provider : OpenAI-compatible (Ollama)");
  console.log("  Base URL : http://localhost:11434/v1");
  console.log("  Model    : aikid123/qwen3-coder:latest (2B + tools)");
  console.log("  [OK] LLM Gateway initialized");

  // ----------------------------------------------------------
  // 2. LLM 任务规划
  // ----------------------------------------------------------
  separator("Step 2: LLM Task Planning");

  console.log("  Asking qwen3:4B to generate execution plan...");

  let plan: ExecutionPlan;
  try {
    const response = await gateway.complete({
      system: `You are a Windows desktop automation agent. Your job is to convert a natural language task into a structured JSON execution plan.

Available step actions:
- cli_spawn : Launch a program/process (params: { command: string })
- wait      : Pause execution (params: { ms: number })
- gui_type  : Type text into the currently focused window (params: { text: string })
- screenshot: Take a full-screen screenshot (params: { filepath: string })

Rules:
1. Always wait after launching a program for it to fully load (2000ms minimum)
2. Always take a screenshot as the last step to verify
3. Use simple, concrete steps
4. For "open Notepad", use cli_spawn with command "start notepad.exe"

Respond ONLY with valid JSON in this exact structure:
{
  "plan": "brief one-line summary of the plan",
  "steps": [
    {
      "stepNum": 1,
      "description": "what this step does",
      "action": "cli_spawn",
      "command": "start notepad.exe"
    }
  ]
}`,
      prompt:
        'Generate a step-by-step plan to: open Notepad, wait for it to fully launch, then type the word "Hello" into Notepad.',
      format: "json",
    });

    console.log(`  [OK] LLM response received (${response.usage.totalTokens} tokens)`);

    // 解析 LLM 返回的 JSON
    let parsed: any;
    try {
      parsed = JSON.parse(response.content);
    } catch {
      // 尝试从 markdown 代码块中提取 JSON
      const jsonMatch = response.content.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[1].trim());
      } else {
        throw new Error("Cannot parse LLM response as JSON");
      }
    }

    plan = parsed as ExecutionPlan;
  } catch (err: any) {
    console.log(`  [WARN] LLM planning failed: ${err.message}`);
    console.log("  [INFO] Using fallback plan...");

    // 回退计划：如果 LLM 调用失败，使用硬编码计划
    plan = {
      plan: "Open Notepad, wait, type 'Hello'",
      steps: [
        {
          stepNum: 1,
          description: "Launch Notepad via start command",
          action: "cli_spawn",
          command: "start notepad.exe",
        },
        {
          stepNum: 2,
          description: "Wait for Notepad to fully open",
          action: "wait",
          ms: 2500,
        },
        {
          stepNum: 3,
          description: 'Type "Hello" into Notepad',
          action: "gui_type",
          text: "Hello",
        },
        {
          stepNum: 4,
          description: "Wait briefly for text to appear",
          action: "wait",
          ms: 500,
        },
        {
          stepNum: 5,
          description: "Take verification screenshot",
          action: "screenshot",
          filepath: path.resolve(OUTPUT_DIR, "demo_screenshot.png"),
        },
      ],
    };
  }

  // 打印计划
  console.log(`\n  Plan: ${plan.plan}`);
  console.log(`  Steps (${plan.steps.length}):`);
  for (const step of plan.steps) {
    console.log(`    ${step.stepNum}. [${step.action}] ${step.description}`);
  }

  // ----------------------------------------------------------
  // 3. 执行计划
  // ----------------------------------------------------------
  separator("Step 3: Execute Plan");

  const startTime = Date.now();

  for (const step of plan.steps) {
    logStep(step.stepNum, step.description, step.action);

    try {
      switch (step.action) {
        case "cli_spawn": {
          const cmd = step.command || "start notepad.exe";
          console.log(`  → Running: ${cmd}`);

          if (cmd.startsWith("start ")) {
            // "start" 命令需要通过 cmd.exe 执行
            const program = cmd.slice(6); // remove "start "
            spawn("cmd.exe", ["/c", "start", "", program], {
              detached: true,
              stdio: "ignore",
            }).unref();
          } else {
            spawn("cmd.exe", ["/c", cmd], {
              detached: true,
              stdio: "ignore",
            }).unref();
          }
          console.log("  [OK] Process launched");
          break;
        }

        case "wait": {
          const ms = step.ms || 2000;
          console.log(`  → Waiting ${ms}ms...`);
          await sleep(ms);
          console.log("  [OK] Wait complete");
          break;
        }

        case "gui_type": {
          const text = step.text || "";
          console.log(`  → Sending keystrokes: "${text}"`);
          sendKeys(text);
          await sleep(300);
          console.log("  [OK] Keys sent");
          break;
        }

        case "screenshot": {
          const filepath = step.filepath || path.resolve(OUTPUT_DIR, "demo_screenshot.png");
          console.log(`  → Capturing: ${path.basename(filepath)}`);
          takeScreenshot(filepath);
          console.log(`  [OK] Saved: ${filepath}`);
          break;
        }

        case "cli_execute": {
          const cmd = step.command || "";
          console.log(`  → Executing: ${cmd}`);
          const output = execSync(cmd, { encoding: "utf-8" });
          console.log(`  [OK] Output: ${output.slice(0, 200)}`);
          break;
        }

        default:
          console.log(`  [SKIP] Unknown action: ${(step as any).action}`);
      }
    } catch (err: any) {
      console.log(`  [FAIL] ${err.message}`);
      // 继续执行后续步骤，不中断整个流程
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  // ----------------------------------------------------------
  // 4. 结果展示
  // ----------------------------------------------------------
  separator("Results");

  console.log(`  Total time      : ${elapsed}s`);
  console.log(`  Steps executed  : ${plan.steps.length}`);
  const stats = gateway.getStats();
  console.log(`  LLM requests    : ${stats.requests}`);
  console.log(`  LLM errors      : ${stats.errors}`);
  console.log(`  LLM error rate  : ${(stats.errorRate * 100).toFixed(1)}%`);

  const screenshotPath = path.resolve(OUTPUT_DIR, "demo_screenshot.png");
  if (fs.existsSync(screenshotPath)) {
    const stat = fs.statSync(screenshotPath);
    console.log(`  Screenshot saved: ${screenshotPath}`);
    console.log(`  File size       : ${(stat.size / 1024).toFixed(1)} KB`);
  }

  console.log(`\n  ✓ Demo complete!\n`);
}

// ============================================================
// 入口
// ============================================================

main().catch((err) => {
  console.error("\n[FATAL] Demo failed:", err.message);
  console.error(err.stack);
  process.exit(1);
});
