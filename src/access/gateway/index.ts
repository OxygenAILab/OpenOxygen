export interface GatewayConfig {
  providers: GatewayProvider[];
  defaultProvider: string;
}

export interface GatewayProvider {
  id: string;
  type: 'websocket' | 'http' | 'stdio';
  config: Record<string, any>;
}

export interface GatewayRequest {
  id: string;
  type: 'task' | 'skill' | 'memory' | 'status';
  payload: any;
  metadata?: Record<string, any>;
}

export interface GatewayResponse {
  id: string;
  success: boolean;
  payload?: any;
  error?: string;
}

export class UnifiedGateway {
  private providers: Map<string, GatewayProvider> = new Map();

  constructor(config: GatewayConfig) {
    for (const provider of config.providers) {
      this.providers.set(provider.id, provider);
    }
  }

  async handleRequest(request: GatewayRequest): Promise<GatewayResponse> {
    const { id, type, payload } = request;

    try {
      switch (type) {
        case 'task':
          return this.handleTaskRequest(id, payload);
        case 'skill':
          return this.handleSkillRequest(id, payload);
        case 'memory':
          return this.handleMemoryRequest(id, payload);
        case 'status':
          return this.handleStatusRequest(id);
        default:
          return { id, success: false, error: `Unknown request type: ${type}` };
      }
    } catch (error) {
      return { id, success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private async handleTaskRequest(id: string, payload: any): Promise<GatewayResponse> {
    return { id, success: true, payload: { message: 'Task request received', payload } };
  }

  private async handleSkillRequest(id: string, payload: any): Promise<GatewayResponse> {
    return { id, success: true, payload: { message: 'Skill request received', payload } };
  }

  private async handleMemoryRequest(id: string, payload: any): Promise<GatewayResponse> {
    return { id, success: true, payload: { message: 'Memory request received', payload } };
  }

  private handleStatusRequest(id: string): GatewayResponse {
    return { id, success: true, payload: { status: 'running', providers: Array.from(this.providers.keys()) } };
  }

  registerProvider(provider: GatewayProvider): void {
    this.providers.set(provider.id, provider);
  }

  unregisterProvider(providerId: string): boolean {
    return this.providers.delete(providerId);
  }
}

export default UnifiedGateway;