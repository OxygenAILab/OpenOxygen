import type { ChatMessage, InferenceResponse } from '../engine';
import { runInference } from '../engine';

export interface ReflectionRequest {
  taskId: string;
  originalRequest: string;
  plan: any;
  executionResults: ExecutionStep[];
  context?: any;
}

export interface ExecutionStep {
  stepId: string;
  type: string;
  description: string;
  success: boolean;
  output: any;
  error?: string;
  durationMs: number;
}

export interface ReflectionResult {
  taskId: string;
  success: boolean;
  summary: string;
  insights: ReflectionInsight[];
  suggestions: string[];
  shouldRetry: boolean;
  retryPlan?: any;
}

export interface ReflectionInsight {
  type: 'success' | 'failure' | 'warning' | 'optimization';
  message: string;
  confidence: number;
  relatedSteps: string[];
}

export class ReflectionEngine {
  async reflect(request: ReflectionRequest): Promise<ReflectionResult> {
    const successCount = request.executionResults.filter(r => r.success).length;
    const failedCount = request.executionResults.length - successCount;
    const isSuccess = failedCount === 0;

    const systemPrompt = `You are a task reflection assistant for a Computer Use Agent.
Analyze the task execution and provide:
1. A concise summary of what was accomplished
2. Key insights about what worked well and what didn't
3. Specific suggestions for improvement
4. Whether the task should be retried
5. If retry is needed, suggest a revised plan

Return results in JSON format.`;

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Analyze this task execution:

Task ID: ${request.taskId}
Original Request: ${request.originalRequest}
Plan: ${JSON.stringify(request.plan)}
Results: ${successCount} succeeded, ${failedCount} failed

Execution Details:
${request.executionResults.map((r, i) => 
  `${i + 1}. [${r.success ? 'SUCCESS' : 'FAILED'}] ${r.type}: ${r.description}
     ${r.success ? `Output: ${JSON.stringify(r.output).substring(0, 100)}` : `Error: ${r.error}`}`
).join('\n')}

Context: ${JSON.stringify(request.context || {})}

Provide reflection analysis as JSON.` }
    ];

    try {
      const response = await runInference({
        messages,
        model: { model: 'gpt-4', provider: 'openai' },
        maxTokens: 2000
      });

      const content = response.content;
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      
      if (jsonMatch) {
        const data = JSON.parse(jsonMatch[0]);
        
        return {
          taskId: request.taskId,
          success: isSuccess,
          summary: data.summary || content.substring(0, 200),
          insights: data.insights || [],
          suggestions: data.suggestions || [],
          shouldRetry: data.shouldRetry || !isSuccess,
          retryPlan: data.retryPlan,
        };
      }

      return {
        taskId: request.taskId,
        success: isSuccess,
        summary: content,
        insights: [],
        suggestions: [],
        shouldRetry: !isSuccess,
      };

    } catch (error) {
      return {
        taskId: request.taskId,
        success: isSuccess,
        summary: `Reflection failed: ${error instanceof Error ? error.message : String(error)}`,
        insights: [],
        suggestions: [],
        shouldRetry: !isSuccess,
      };
    }
  }

  async analyzeFailure(
    taskId: string,
    step: ExecutionStep,
    context: any
  ): Promise<{ reason: string; fixSuggestion: string; shouldRetry: boolean }> {
    const systemPrompt = `You are a failure analysis assistant.
Analyze the failed step and provide:
1. The most likely reason for failure
2. A specific fix suggestion
3. Whether this step should be retried

Return results in JSON format.`;

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Analyze this failed step:

Task ID: ${taskId}
Step Type: ${step.type}
Step Description: ${step.description}
Error: ${step.error}
Duration: ${step.durationMs}ms
Context: ${JSON.stringify(context)}

Provide analysis as JSON with keys: reason, fixSuggestion, shouldRetry.` }
    ];

    const response = await runInference({
      messages,
      model: { model: 'gpt-4', provider: 'openai' },
      maxTokens: 1000
    });

    const content = response.content;
    const jsonMatch = content.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      const data = JSON.parse(jsonMatch[0]);
      return {
        reason: data.reason || 'Unknown',
        fixSuggestion: data.fixSuggestion || '',
        shouldRetry: data.shouldRetry ?? true,
      };
    }

    return {
      reason: content,
      fixSuggestion: 'Retry with adjusted parameters',
      shouldRetry: true,
    };
  }

  async generateSummary(
    taskId: string,
    originalRequest: string,
    results: ExecutionStep[]
  ): Promise<string> {
    const successCount = results.filter(r => r.success).length;
    const totalCount = results.length;

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: 'You are a task summarization assistant. Generate a concise summary of what was accomplished.'
      },
      {
        role: 'user',
        content: `Summarize this task:
Task ID: ${taskId}
Request: ${originalRequest}
Results: ${successCount}/${totalCount} steps completed

Provide a 1-2 sentence summary.`
      }
    ];

    const response = await runInference({
      messages,
      model: { model: 'gpt-4', provider: 'openai' },
      maxTokens: 200
    });

    return response.content;
  }
}

export default ReflectionEngine;