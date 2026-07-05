/**
 * 多 Agent 注册、发现、路由与协作
 */

export type AgentCollaborationMode = 'parallel' | 'sequential' | 'voting';

export interface AgentMessage {
  id?: string;
  from?: string;
  to?: string;
  task: string;
  context?: any;
  timestamp?: number;
}

export interface AgentResult {
  agentId: string;
  success: boolean;
  output: any;
  score?: number;
  error?: string;
}

export interface AgentCapability {
  name: string;
  description?: string;
  score?: number;
}

export interface OpenOxygenAgent {
  id: string;
  name: string;
  description?: string;
  capabilities: AgentCapability[];
  execute(message: AgentMessage): Promise<AgentResult>;
}

export interface CollaborationRequest {
  task: string;
  mode?: AgentCollaborationMode;
  requiredCapabilities?: string[];
  context?: any;
  maxAgents?: number;
}

export class AgentRegistry {
  private agents = new Map<string, OpenOxygenAgent>();

  register(agent: OpenOxygenAgent): void {
    if (!agent.id) throw new Error('Agent id is required');
    this.agents.set(agent.id, agent);
  }

  unregister(agentId: string): boolean {
    return this.agents.delete(agentId);
  }

  discover(capabilities: string[] = []): OpenOxygenAgent[] {
    const all = [...this.agents.values()];
    if (capabilities.length === 0) return all;

    return all
      .map(agent => ({ agent, score: this.matchScore(agent, capabilities) }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(item => item.agent);
  }

  get(agentId: string): OpenOxygenAgent | undefined {
    return this.agents.get(agentId);
  }

  list(): Array<{ id: string; name: string; capabilities: string[] }> {
    return [...this.agents.values()].map(agent => ({
      id: agent.id,
      name: agent.name,
      capabilities: agent.capabilities.map(c => c.name),
    }));
  }

  async route(message: AgentMessage): Promise<AgentResult> {
    const target = message.to ? this.agents.get(message.to) : this.discover([message.task])[0];
    if (!target) throw new Error(`No agent found for task: ${message.task}`);

    return target.execute({
      ...message,
      id: message.id || `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      to: target.id,
      timestamp: message.timestamp || Date.now(),
    });
  }

  async collaborate(request: CollaborationRequest): Promise<AgentResult[]> {
    const mode = request.mode || 'sequential';
    const agents = this.discover(request.requiredCapabilities || [request.task]).slice(0, request.maxAgents || 4);
    if (agents.length === 0) throw new Error(`No agents available for task: ${request.task}`);

    if (mode === 'parallel' || mode === 'voting') {
      const results = await Promise.all(agents.map(agent => this.send(agent, request)));
      return mode === 'voting' ? this.rankVotingResults(results) : results;
    }

    const results: AgentResult[] = [];
    let context = request.context;
    for (const agent of agents) {
      const result = await this.send(agent, { ...request, context });
      results.push(result);
      context = { ...context, previousResult: result.output };
      if (!result.success) break;
    }
    return results;
  }

  private async send(agent: OpenOxygenAgent, request: CollaborationRequest): Promise<AgentResult> {
    try {
      return await agent.execute({
        id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        to: agent.id,
        task: request.task,
        context: request.context,
        timestamp: Date.now(),
      });
    } catch (error) {
      return {
        agentId: agent.id,
        success: false,
        output: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private matchScore(agent: OpenOxygenAgent, required: string[]): number {
    const haystack = [
      agent.name,
      agent.description || '',
      ...agent.capabilities.flatMap(c => [c.name, c.description || '']),
    ].join(' ').toLowerCase();

    return required.reduce((score, item) => {
      const needle = item.toLowerCase();
      const exact = agent.capabilities.find(c => c.name.toLowerCase() === needle);
      if (exact) return score + (exact.score || 10);
      return haystack.includes(needle) ? score + 1 : score;
    }, 0);
  }

  private rankVotingResults(results: AgentResult[]): AgentResult[] {
    return [...results].sort((a, b) => {
      if (a.success !== b.success) return a.success ? -1 : 1;
      return (b.score || 0) - (a.score || 0);
    });
  }
}
