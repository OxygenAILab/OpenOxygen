/**
 * AgentLoop —— 自然语言目标驱动的感知-决策-行动闭环
 *
 * 与 SimplePlanner→PlanExecutor 的"一次性脚本生成→盲执行"模式相对:
 * LLM 在每一步都看到当前观察(截图/UIA 定位/命令输出),自己决定下一个工具调用,
 * 直到调用 finish 或达到步数上限。这是项目定位(UI-TARS 式视觉 Agent)的主路径。
 */

import {
  runInference,
  type ChatMessage,
  type ModelConfig,
  type ToolCallRequest,
  type ToolSchema,
} from '../inference/engine';
import { logger, metrics } from '../observability';

/** AgentLoop 需要的 GUI 能力(RobotGuiController/WindowsGuiController 均满足) */
export interface AgentLoopGui {
  screenshot?(): Promise<string>;
  click(x: number, y: number): Promise<{ success: boolean; error?: string }>;
  right_click?(x: number, y: number): Promise<{ success: boolean; error?: string }>;
  double_click?(x: number, y: number): Promise<{ success: boolean; error?: string }>;
  type_text(text: string): Promise<{ success: boolean; error?: string }>;
  key_press(key: string): Promise<{ success: boolean; error?: string }>;
  scroll(amount: number): Promise<{ success: boolean; error?: string }>;
  locateByDescription?(description: string): Promise<{ x: number; y: number } | null>;
}

export interface AgentLoopOptions {
  /** 自然语言目标 */
  goal: string;
  model: ModelConfig;
  gui?: AgentLoopGui;
  cli?: { execute(params: { command: string; timeout?: number }): Promise<{ success: boolean; exit_code: number; stdout: string; stderr: string }> };
  maxSteps?: number;
  temperature?: number;
  /** 工具执行超时(仅 cli) */
  cliTimeoutMs?: number;
}

export interface AgentLoopResult {
  success: boolean;
  summary: string;
  steps: number;
  error?: string;
}

interface ToolExecution {
  ok: boolean;
  payload: string;
  /** 截图工具产出,追加为带图 user 观察消息 */
  image?: string;
  finished?: boolean;
}

export const AGENT_LOOP_SYSTEM_PROMPT = `你是 OpenOxygen,一个 Windows 桌面自动化 Agent。用户给你一个自然语言目标,你通过工具调用逐步完成它。

决策原则:
1. 行动前先观察:任务开始和界面不确定时,先调用 screenshot 看清当前状态再决定动作。
2. 每轮一个动作,看到结果再做下一个决定。关键动作后用截图验证效果。
3. 优先键盘方案(组合键 key 工具,SendKeys 语法: ^=Ctrl #=Win %=Alt +=Shift,{ENTER}/{TAB}/{F5} 等),比点击更可靠。
4. 点击用 click(x,y):坐标来自截图观察或 uia_locate 定位。
5. 命令行任务用 cli(如启动程序 start notepad、查询文件)。
6. 截图以 user 消息形式出现在你的下文中,基于最新一张图判断。
7. 目标完成后调用 finish 并给出简短总结;卡住时也调用 finish 说明原因,不要无限重试同一动作。`;

/** 按可用能力裁剪工具声明(无 GUI 不给 GUI 工具,无 CLI 不给 cli) */
export function toolSchemas(gui: AgentLoopGui | undefined, hasCli: boolean): ToolSchema[] {
  const schemas: ToolSchema[] = [];
  if (gui?.screenshot) {
    schemas.push({
      type: 'function',
      function: {
        name: 'screenshot',
        description: '截取当前屏幕,图像会作为下一条 user 消息提供给你',
        parameters: { type: 'object', properties: {}, required: [] },
      },
    });
  }
  if (gui?.locateByDescription) {
    schemas.push({
      type: 'function',
      function: {
        name: 'uia_locate',
        description: '用 Windows UIA 按描述定位界面元素,返回元素中心坐标(零视觉开销,优先尝试)',
        parameters: {
          type: 'object',
          properties: { description: { type: 'string', description: '元素描述,如 "记事本窗口"、"保存按钮"' } },
          required: ['description'],
        },
      },
    });
  }
  if (gui) {
    schemas.push({
      type: 'function',
      function: {
        name: 'click',
        description: '在指定坐标点击鼠标',
        parameters: {
          type: 'object',
          properties: {
            x: { type: 'number' },
            y: { type: 'number' },
            button: { type: 'string', enum: ['left', 'right', 'double'], description: '默认 left' },
          },
          required: ['x', 'y'],
        },
      },
    });
    schemas.push({
      type: 'function',
      function: {
        name: 'type',
        description: '输入字面文本(组合键请用 key 工具)',
        parameters: {
          type: 'object',
          properties: { text: { type: 'string' } },
          required: ['text'],
        },
      },
    });
    schemas.push({
      type: 'function',
      function: {
        name: 'key',
        description: '发送组合键/单键(SendKeys 语法:#r=Win+R, ^a=Ctrl+A, %{F4}=Alt+F4, {ENTER}, {F5})',
        parameters: {
          type: 'object',
          properties: { combo: { type: 'string', examples: ['#r', '^a', '{ENTER}'] } },
          required: ['combo'],
        },
      },
    });
    schemas.push({
      type: 'function',
      function: {
        name: 'scroll',
        description: '滚动鼠标滚轮(正数向下)',
        parameters: {
          type: 'object',
          properties: { amount: { type: 'number' } },
          required: ['amount'],
        },
      },
    });
  }
  if (hasCli) {
    schemas.push({
      type: 'function',
      function: {
        name: 'cli',
        description: '执行命令行命令并返回 stdout/stderr/退出码',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string' },
            timeout_ms: { type: 'number', description: '默认 60000' },
          },
          required: ['command'],
        },
      },
    });
  }
  schemas.push({
    type: 'function',
    function: {
      name: 'wait',
      description: '等待界面/程序加载(毫秒)',
      parameters: {
        type: 'object',
        properties: { ms: { type: 'number' } },
        required: ['ms'],
      },
    },
  });
  schemas.push({
    type: 'function',
    function: {
      name: 'finish',
      description: '任务完成或无法继续时调用,给出简短总结',
      parameters: {
        type: 'object',
        properties: { summary: { type: 'string' } },
        required: ['summary'],
      },
    },
  });
  return schemas;
}

export class AgentLoop {
  private isRunning = false;

  stop(): void {
    this.isRunning = false;
  }

  async run(options: AgentLoopOptions): Promise<AgentLoopResult> {
    if (this.isRunning) {
      throw new Error('AgentLoop is already running; create a separate instance for concurrent tasks');
    }
    this.isRunning = true;

    const { goal, model, gui, cli } = options;
    const maxSteps = options.maxSteps ?? 25;
    const taskId = `agent_${Date.now()}`;
    const startTime = Date.now();

    logger.taskStart(taskId, goal, 'agent-loop');

    const messages: ChatMessage[] = [{ role: 'user', content: goal }];
    const schemas = toolSchemas(gui, Boolean(cli));
    let nudges = 0;
    let lastActionHash: string | null = null;
    let repeatCount = 0;

    try {
      for (let step = 1; step <= maxSteps && this.isRunning; step++) {
        const response = await this.runInferenceWithRetry(
          {
            messages,
            systemPrompt: AGENT_LOOP_SYSTEM_PROMPT,
            tools: schemas,
            model,
            temperature: options.temperature ?? 0.2,
            maxTokens: 4000,
          },
          taskId
        );

        // ── 有工具调用:执行并回填观察 ──
        if (response.toolCalls?.length) {
          nudges = 0;
          messages.push({
            role: 'assistant',
            content: response.content || '',
            toolCalls: response.toolCalls,
          });

          for (const tc of response.toolCalls) {
            // 循环检测:同一动作连续出现 3 次视为卡死,在执行前拦截
            // (GUI 动作重复可能有真实副作用,宁可不执行第 3 次)
            const hash = `${tc.name}:${tc.arguments}`;
            if (tc.name !== 'wait' && hash === lastActionHash) {
              repeatCount++;
            } else {
              repeatCount = 1;
              lastActionHash = hash;
            }
            if (repeatCount >= 3) {
              logger.taskEnd(taskId, false, 1, 0);
              return {
                success: false,
                summary: '',
                steps: step,
                error: `同一动作连续出现 ${repeatCount} 次,判定为循环卡死: ${tc.name} ${tc.arguments.slice(0, 120)}`,
              };
            }

            const exec = await this.executeTool(tc, { gui, cli, taskId, cliTimeoutMs: options.cliTimeoutMs });

            messages.push({
              role: 'tool',
              toolCallId: tc.id,
              name: tc.name,
              content: exec.payload,
            });
            if (exec.image) {
              // 截图观察:OpenAI 协议的 tool 消息不带图,追加带图 user 消息。
              // 同时瘦身历史:旧截图替换为占位,防止多轮累积超过网关请求体上限
              for (const m of messages) {
                if (m.images?.length) {
                  m.images = [];
                  m.content = '[历史截图已省略]';
                }
              }
              messages.push({
                role: 'user',
                content: '[截图观察] 以上是工具结果,下图是当前屏幕状态:',
                images: [exec.image],
              });
            }

            if (exec.finished) {
              const durationMs = Date.now() - startTime;
              logger.taskEnd(taskId, exec.ok, 1, 1);
              metrics.recordTask(exec.ok, durationMs);
              return { success: exec.ok, summary: exec.payload, steps: step };
            }
          }
          continue;
        }

        // ── 无工具调用:纯文本响应 ──
        messages.push({ role: 'assistant', content: response.content || '(空响应)' });
        nudges++;
        if (nudges >= 2) {
          // LLM 连续两轮只说话不行动,视为它选择文字收尾
          const durationMs = Date.now() - startTime;
          logger.taskEnd(taskId, true, 1, 1);
          metrics.recordTask(true, durationMs);
          return { success: true, summary: response.content, steps: step };
        }
        messages.push({
          role: 'user',
          content: '(请通过工具调用执行下一步动作;若任务已完成,调用 finish 工具)',
        });
      }

      logger.taskEnd(taskId, false, 1, 0);
      return {
        success: false,
        summary: '',
        steps: maxSteps,
        error: `达到最大步数上限(${maxSteps}),任务未完成`,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.taskEnd(taskId, false, 1, 0);
      return { success: false, summary: '', steps: 0, error: msg };
    } finally {
      this.isRunning = false;
    }
  }

  /** 推理调用瞬态错误退避重试(上游不可用/限流/网关错误/网络失败;4xx 参数类不重试) */
  private async runInferenceWithRetry(
    request: Parameters<typeof runInference>[0],
    taskId: string,
    maxRetries = 2
  ): Promise<Awaited<ReturnType<typeof runInference>>> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        const delayMs = attempt * 3000;
        logger.log({
          level: 'warn',
          type: 'retry',
          taskId,
          stepId: 'inference',
          message: `推理调用瞬态失败,${delayMs}ms 后重试(${attempt}/${maxRetries})`,
          data: { error: lastError instanceof Error ? lastError.message : String(lastError) },
          tags: ['agent-loop'],
        });
        await new Promise((r) => setTimeout(r, delayMs));
      }
      try {
        return await runInference(request);
      } catch (error) {
        lastError = error;
        const msg = error instanceof Error ? error.message : String(error);
        if (!/upstream|50[0-3]|429|fetch failed|network|timeout|ECONN/i.test(msg)) {
          throw error;
        }
      }
    }
    throw lastError;
  }

  private async executeTool(
    tc: ToolCallRequest,
    ctx: {
      gui?: AgentLoopGui;
      cli?: AgentLoopOptions['cli'];
      taskId: string;
      cliTimeoutMs?: number;
    }
  ): Promise<ToolExecution> {
    const started = Date.now();
    let args: any = {};
    try {
      args = JSON.parse(tc.arguments || '{}');
    } catch {
      return { ok: false, payload: `工具参数不是合法 JSON: ${tc.arguments.slice(0, 200)}` };
    }

    let out: ToolExecution;
    try {
      out = await this.dispatchTool(tc.name, args, ctx);
    } catch (error) {
      out = { ok: false, payload: `工具执行异常: ${error instanceof Error ? error.message : String(error)}` };
    }

    metrics.recordStep(tc.name, out.ok, Date.now() - started);
    logger.log({
      level: out.ok ? 'info' : 'warn',
      type: 'step_end',
      taskId: ctx.taskId,
      stepId: `${tc.name}#${Date.now()}`,
      message: `工具 ${tc.name} ${out.ok ? '成功' : '失败'}`,
      data: { payload: out.payload.slice(0, 300) },
      tags: ['agent-loop'],
    });
    return out;
  }

  private async dispatchTool(
    name: string,
    args: any,
    ctx: { gui?: AgentLoopGui; cli?: AgentLoopOptions['cli']; taskId: string; cliTimeoutMs?: number }
  ): Promise<ToolExecution> {
    const gui = ctx.gui;

    switch (name) {
      case 'screenshot': {
        if (!gui?.screenshot) return { ok: false, payload: 'GUI 控制器不可用' };
        const base64 = await gui.screenshot();
        return { ok: true, payload: `截图已捕获(${Math.round((base64.length * 3) / 4 / 1024)} KB),见下一条 user 消息`, image: base64 };
      }
      case 'uia_locate': {
        if (!gui?.locateByDescription) return { ok: false, payload: 'UIA 定位不可用' };
        const found = await gui.locateByDescription(String(args.description ?? ''));
        return found
          ? { ok: true, payload: `找到元素,中心坐标 (${Math.round(found.x)}, ${Math.round(found.y)})` }
          : { ok: false, payload: '未找到元素(可尝试 screenshot 后按坐标点击)' };
      }
      case 'click': {
        if (!gui) return { ok: false, payload: 'GUI 控制器不可用' };
        const x = Number(args.x);
        const y = Number(args.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
          return { ok: false, payload: 'click 需要合法的数字坐标 x/y' };
        }
        const button = args.button === 'right' ? gui.right_click?.bind(gui) : args.button === 'double' ? gui.double_click?.bind(gui) : null;
        const r = button
          ? await button(x, y)
          : await gui.click(x, y);
        return { ok: r.success, payload: r.success ? `已点击 (${x}, ${y})` : `点击失败: ${r.error}` };
      }
      case 'type': {
        if (!gui) return { ok: false, payload: 'GUI 控制器不可用' };
        const r = await gui.type_text(String(args.text ?? ''));
        return { ok: r.success, payload: r.success ? '文本已输入' : `输入失败: ${r.error}` };
      }
      case 'key': {
        if (!gui) return { ok: false, payload: 'GUI 控制器不可用' };
        const r = await gui.key_press(String(args.combo ?? ''));
        return { ok: r.success, payload: r.success ? `按键 ${args.combo} 已发送` : `按键失败: ${r.error}` };
      }
      case 'scroll': {
        if (!gui?.scroll) return { ok: false, payload: 'GUI 控制器不可用' };
        const r = await gui.scroll(Number(args.amount ?? 0));
        return { ok: r.success, payload: r.success ? '已滚动' : `滚动失败: ${r.error}` };
      }
      case 'cli': {
        if (!ctx.cli) return { ok: false, payload: 'CLI 执行器不可用' };
        const r = await ctx.cli.execute({
          command: String(args.command ?? ''),
          timeout: Number(args.timeout_ms) || ctx.cliTimeoutMs || 60000,
        });
        const payload = [
          `exit_code=${r.exit_code}`,
          r.stdout ? `stdout:\n${r.stdout.slice(0, 2000)}` : '',
          r.stderr ? `stderr:\n${r.stderr.slice(0, 1000)}` : '',
        ]
          .filter(Boolean)
          .join('\n');
        return { ok: r.success, payload };
      }
      case 'wait': {
        const ms = Math.min(Math.max(Number(args.ms) || 1000, 1), 60000);
        await new Promise((r) => setTimeout(r, ms));
        return { ok: true, payload: `已等待 ${ms}ms` };
      }
      case 'finish': {
        const summary = String(args.summary ?? '').trim();
        return { ok: summary.length > 0, payload: summary || 'finish 缺少 summary', finished: true };
      }
      default:
        return { ok: false, payload: `未知工具: ${name}` };
    }
  }
}
