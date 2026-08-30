/**
 * 简单 Planner 实现 - 使用 LLM 将任务转换为可执行步骤
 */

import { runInference, type ChatMessage } from '../inference/engine';
import { TaskPlanner, type PlanParams, type TaskPlan, type PlanStep } from './planner';
import { logger, metrics } from '../observability';

const PLANNER_SYSTEM_PROMPT = `你是一个计算机自动化任务规划专家。你的任务是将用户的自然语言描述转换为可执行的步骤序列。

可用的步骤类型：
- gui_click: 点击屏幕上的元素（参数：target 元素描述或坐标对象 {x, y}，button: 'left'|'right'|'double'）
- gui_type: 在指定位置输入文本（参数：target 元素描述或坐标，text 要输入的内容，clearFirst 是否先清空）
- gui_wait_for: 等待元素出现（参数：target 元素描述，timeout 超时毫秒）
- gui_screenshot: 截图
- cli_execute: 执行命令行命令（参数：command 命令，cwd 工作目录）
- wait: 暂停执行（参数：durationMs 毫秒）

规划原则：
1. 拆分成最小可验证的步骤
2. **优先使用键盘快捷键**而非点击 UI 元素：
   - 打开运行对话框：gui_type 发送 "^{ESC}" (Win+R 的 SendKeys 写法)
   - 最小化窗口：gui_type 发送 "^{DOWN}"
   - 复制粘贴：gui_type 发送 "^c" / "^v"
3. **用固定 wait 步骤等待界面加载**，而非 gui_wait_for（UIA 定位不稳定）：
   - 对话框打开后：wait 500-1000ms
   - 应用启动后：wait 2000-3000ms
   - 菜单展开后：wait 300-500ms
4. 如果必须点击，用固定坐标（如屏幕中心 {x: 500, y: 500}）
5. 关键步骤后截图验证
6. 设置合理的超时（GUI 默认 30000ms，CLI 默认 60000ms）
7. 依赖关系：后续步骤依赖前面步骤的 id

输出格式（严格 JSON）：
{
  "steps": [
    {
      "id": "step1",
      "type": "gui_type",
      "description": "打开运行对话框",
      "params": {
        "text": "^{ESC}"
      },
      "dependencies": [],
      "expectedOutcome": "运行对话框打开"
    },
    {
      "id": "step2",
      "type": "wait",
      "description": "等待对话框加载",
      "params": {
        "durationMs": 500
      },
      "dependencies": ["step1"],
      "expectedOutcome": "对话框完全显示"
    },
    {
      "id": "step3",
      "type": "gui_type",
      "description": "输入 notepad 命令",
      "params": {
        "text": "notepad"
      },
      "dependencies": ["step2"],
      "expectedOutcome": "命令已输入"
    },
    {
      "id": "step4",
      "type": "gui_type",
      "description": "按回车键执行",
      "params": {
        "text": "{ENTER}"
      },
      "dependencies": ["step3"],
      "expectedOutcome": "记事本启动"
    },
    {
      "id": "step5",
      "type": "wait",
      "description": "等待记事本完全加载",
      "params": {
        "durationMs": 2000
      },
      "dependencies": ["step4"],
      "expectedOutcome": "记事本窗口就绪"
    }
  ]
}

注意：
- 只返回 JSON，不要额外解释
- 优先用键盘快捷键（gui_type 发送 SendKeys 语法），避免依赖 UIA 定位
- Windows 应用用命令名（notepad、calc、mspaint）而非中文
- SendKeys 特殊键：^ = Ctrl，+ = Shift，% = Alt，{ESC} = Win 键
- 依赖关系必须引用已存在的步骤 id`;

export class SimplePlanner extends TaskPlanner {
  /**
   * 使用 LLM 生成执行计划
   */
  async createPlan(params: PlanParams): Promise<TaskPlan> {
    const startTime = Date.now();

    // 记录规划开始
    logger.planStart(params.taskId, params.description);

    const messages: ChatMessage[] = [
      {
        role: 'user',
        content: `请为以下任务生成执行计划：

任务描述: ${params.description}
执行模式: ${params.mode}
${params.context ? `上下文: ${JSON.stringify(params.context)}` : ''}

请返回 JSON 格式的步骤序列。`,
      },
    ];

    try {
      const apiKey = process.env.OPENOXYGEN_PLANNER_API_KEY || process.env.OPENAI_API_KEY || '';
      if (!apiKey) {
        throw new Error(
          '缺少 Planner API Key：请设置 OPENOXYGEN_PLANNER_API_KEY 或 OPENAI_API_KEY（参考 .env.example）'
        );
      }

      const response = await runInference({
        messages,
        systemPrompt: PLANNER_SYSTEM_PROMPT,
        model: {
          provider: 'openai',
          model: process.env.OPENOXYGEN_PLANNER_MODEL || 'cerebras/gemma-4-31b',
          baseUrl: process.env.OPENOXYGEN_PLANNER_BASE_URL || 'https://api.123nhh.com/v1',
          apiKey,
        },
        maxTokens: 4000,
        temperature: 0.1, // 低温度，确保输出稳定
      });

      // 记录 token 消耗
      if (response.usage) {
        metrics.recordTokens(
          'cerebras',
          response.usage.promptTokens,
          response.usage.completionTokens
        );
      }

      // 提取 JSON（LLM 可能返回 markdown 包裹的 JSON）
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        const error = `LLM 未返回有效 JSON: ${response.content.substring(0, 200)}`;
        logger.planEnd(params.taskId, false, undefined, error);
        throw new Error(error);
      }

      const planData = JSON.parse(jsonMatch[0]);

      if (!planData.steps || !Array.isArray(planData.steps)) {
        const error = '计划缺少 steps 数组';
        logger.planEnd(params.taskId, false, undefined, error);
        throw new Error(error);
      }

      const plan: TaskPlan = {
        taskId: params.taskId,
        version: '2.0',
        description: params.description,
        steps: this.validateAndEnrichSteps(planData.steps),
        dependencies: this.buildDependencyMap(planData.steps),
        rollbackSteps: planData.rollbackSteps,
      };

      // 记录规划成功
      const durationMs = Date.now() - startTime;
      logger.planEnd(params.taskId, true, plan.steps.length);
      metrics.recordPlan(true, durationMs);

      return plan;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMsg = error instanceof Error ? error.message : String(error);

      logger.planEnd(params.taskId, false, undefined, errorMsg);
      metrics.recordPlan(false, durationMs);

      throw new Error(`生成计划失败: ${errorMsg}`);
    }
  }

  /**
   * 验证并丰富步骤（继承自 TaskPlanner，添加额外验证）
   */
  protected validateAndEnrichSteps(steps: any[]): PlanStep[] {
    const enriched = super.validateAndEnrichSteps(steps);

    // 额外验证
    for (const step of enriched) {
      // gui_type 必须有非空 text：空文本会在执行层产生零事件 no-op 却虚报成功
      if (step.type === 'gui_type') {
        const text = step.params?.text;
        if (typeof text !== 'string' || text.trim().length === 0) {
          throw new Error(
            `${step.id} (gui_type) 缺少非空 text 参数（点击用 gui_click，命令用 cli_execute）`
          );
        }
      }

      // 需要定位的 GUI 步骤必须有 target（键盘型 gui_type 和截图除外）
      if (
        (step.type === 'gui_click' || step.type === 'gui_wait_for') &&
        !step.params.target
      ) {
        console.warn(`警告: ${step.id} (${step.type}) 缺少 target 参数`);
      }

      // 验证依赖关系
      for (const depId of step.dependencies) {
        if (!enriched.find((s) => s.id === depId)) {
          throw new Error(`${step.id} 依赖不存在的步骤: ${depId}`);
        }
      }
    }

    return enriched;
  }
}

/**
 * 简化的调用接口
 */
export async function generatePlan(
  description: string,
  mode: 'gui' | 'cli' | 'auto' = 'auto',
  context?: any
): Promise<TaskPlan> {
  const planner = new SimplePlanner(null); // llmGateway 不再需要
  return planner.createPlan({
    taskId: `task_${Date.now()}`,
    description,
    mode,
    analysis: null,
    context: context || {},
  });
}
