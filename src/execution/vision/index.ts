import { runInference, type ChatMessage, type ModelConfig } from '../../inference/engine';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export interface VisionAnalysisRequest {
  imagePath: string;
  prompt: string;
  context?: string;
  taskId?: string;
}

export interface VisionAnalysisResult {
  success: boolean;
  description: string;
  elements?: UIElement[];
  actions?: SuggestedAction[];
  error?: string;
}

export interface UIElement {
  id: string;
  type: string;
  text?: string;
  bounds: { x: number; y: number; width: number; height: number };
  confidence: number;
  attributes?: Record<string, string>;
}

export interface SuggestedAction {
  type: 'click' | 'type' | 'scroll' | 'wait';
  target?: string;
  params?: Record<string, unknown>;
  reason: string;
}

export interface VisualFeedback {
  screenshotPath: string;
  analysis: VisionAnalysisResult;
  timestamp: number;
  taskId: string;
}

const VISION_MODELS = {
  qwen3vl: {
    model: 'qwen3-vl:8b',
    provider: 'ollama' as const,
    baseUrl: 'http://localhost:11434'
  },
  qwen3vlSmall: {
    model: 'qwen3-vl:4b',
    provider: 'ollama' as const,
    baseUrl: 'http://localhost:11434'
  }
};

const SCREENSHOT_DIR = path.join(os.tmpdir(), 'openoxygen-screenshots');

async function ensureScreenshotDir(): Promise<void> {
  try {
    await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
  } catch {}
}

export async function saveScreenshot(
  base64Data: string,
  taskId?: string
): Promise<string> {
  await ensureScreenshotDir();
  
  const filename = `screenshot-${taskId || `scr-${Date.now()}`}-${Date.now()}.png`;
  const filepath = path.join(SCREENSHOT_DIR, filename);
  
  await fs.writeFile(filepath, Buffer.from(base64Data, 'base64'));
  
  return filepath;
}

const DEFAULT_ANALYSIS_PROMPT = `分析这张截图，提供以下信息：
1. 当前页面是什么？
2. 有哪些可交互元素？
3. 当前状态是否正常？
4. 如果需要操作，建议下一步做什么？

请按以下JSON格式输出：
{
  "description": "页面描述",
  "elements": [
    {"type": "按钮/输入框/链接", "text": "文本内容", "bounds": {"x": 0, "y": 0, "width": 100, "height": 30}}
  ],
  "actions": [
    {"type": "click/type/scroll", "target": "目标描述", "reason": "原因"}
  ]
}`;

export async function analyzeScreenshot(
  request: VisionAnalysisRequest
): Promise<VisionAnalysisResult> {
  try {
    const imageBuffer = await fs.readFile(request.imagePath);
    const base64Image = imageBuffer.toString('base64');
    
    const messages: ChatMessage[] = [
      {
        role: 'user',
        content: request.prompt || DEFAULT_ANALYSIS_PROMPT,
        images: [base64Image]
      }
    ];

    const response = await runInference({
      messages,
      model: VISION_MODELS.qwen3vlSmall,
      maxTokens: 2000
    });

    const content = response.content;
    const jsonMatch = content.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      try {
        const data = JSON.parse(jsonMatch[0]);

        const result: VisionAnalysisResult = {
          success: true,
          description: data.description || content.substring(0, 200),
          elements: data.elements || [],
          actions: data.actions || []
        };

        return result;
      } catch (e) {
        // JSON 解析失败，返回纯文本响应
      }
    }

    return {
      success: true,
      description: content,
      elements: [],
      actions: []
    };

  } catch (error) {
    return {
      success: false,
      description: '',
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function quickVisualCheck(
  imagePath: string,
  expectedState: string
): Promise<{ match: boolean; actualState: string }> {
  try {
    const result = await analyzeScreenshot({
      imagePath,
      prompt: `快速检查：当前页面是否是"${expectedState}"？只回答"是"或"否"，并简要说明实际状态。`
    });

    const isMatch = result.description.toLowerCase().includes('是') ||
                   result.description.toLowerCase().includes('yes');

    return {
      match: isMatch,
      actualState: result.description
    };
  } catch (error) {
    return {
      match: false,
      actualState: '检查失败'
    };
  }
}

export async function findElement(
  imagePath: string,
  elementDescription: string
): Promise<UIElement | null> {
  try {
    const result = await analyzeScreenshot({
      imagePath,
      prompt: `在截图中查找"${elementDescription}"。必须返回 JSON 格式：
{
  "found": true/false,
  "elements": [
    {
      "id": "1",
      "type": "窗口/按钮/输入框",
      "text": "元素文本",
      "bounds": {"x": 左上角X, "y": 左上角Y, "width": 宽度, "height": 高度},
      "confidence": 0.0-1.0
    }
  ]
}

如果找到，返回元素的像素坐标（左上角 x,y + 宽高）。如果找不到，返回 {"found": false, "elements": []}`
    });

    if (result.elements && result.elements.length > 0) {
      const element = result.elements.find(e =>
        e.text?.toLowerCase().includes(elementDescription.toLowerCase())
      ) || result.elements[0];

      return element;
    }

    return null;
  } catch (error) {
    return null;
  }
}

export async function provideVisualFeedback(
  screenshotBase64: string,
  currentTask: string,
  expectedOutcome?: string
): Promise<{
  success: boolean;
  feedback: string;
  shouldRetry?: boolean;
  suggestedFix?: string;
}> {
  try {
    const imagePath = await saveScreenshot(screenshotBase64);
    
    const prompt = expectedOutcome 
      ? `检查当前状态是否符合预期"${expectedOutcome}"。如果不符合，说明问题并提供修复建议。`
      : `分析当前页面状态，判断是否成功完成了"${currentTask}"。`;
    
    const analysis = await analyzeScreenshot({
      imagePath,
      prompt,
      taskId: currentTask
    });

    if (!analysis.success) {
      return {
        success: false,
        feedback: '视觉分析失败',
        shouldRetry: true
      };
    }

    const isSuccess = analysis.description.toLowerCase().includes('成功') ||
                     analysis.description.toLowerCase().includes('完成') ||
                     analysis.description.toLowerCase().includes('正常');

    return {
      success: isSuccess,
      feedback: analysis.description,
      shouldRetry: !isSuccess && analysis.actions && analysis.actions.length > 0,
      suggestedFix: analysis.actions?.[0]?.reason
    };

  } catch (error) {
    return {
      success: false,
      feedback: `视觉反馈出错: ${error instanceof Error ? error.message : String(error)}`,
      shouldRetry: false
    };
  }
}

interface LearningExample {
  screenshot: string;
  context: string;
  correctAction: string;
  timestamp: number;
}

const learningExamples: LearningExample[] = [];

export function recordLearningExample(
  screenshot: string,
  context: string,
  correctAction: string
): void {
  learningExamples.push({
    screenshot,
    context,
    correctAction,
    timestamp: Date.now()
  });

  if (learningExamples.length > 100) {
    learningExamples.shift();
  }
}

export function getLearningDataset(): LearningExample[] {
  return [...learningExamples];
}

export {
  VISION_MODELS,
  SCREENSHOT_DIR,
  ensureScreenshotDir
};

export default {
  analyzeScreenshot,
  quickVisualCheck,
  findElement,
  saveScreenshot,
  provideVisualFeedback,
  recordLearningExample,
  getLearningDataset
};