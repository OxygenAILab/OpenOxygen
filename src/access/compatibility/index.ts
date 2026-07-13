export interface OpenClawConfig {
  gatewayUrl?: string;
  skillManagerUrl?: string;
  sessionManagerUrl?: string;
  enableCompatMode?: boolean;
}

export interface OpenClawContext {
  sessionId: string;
  userId?: string;
  metadata?: Record<string, any>;
}

export interface OpenClawMessage {
  role: 'user' | 'agent' | 'system';
  content: string;
  timestamp: number;
}

export class OpenClawCompatAdapter {
  private config: OpenClawConfig;
  private isConnected = false;

  constructor(config: OpenClawConfig) {
    this.config = {
      enableCompatMode: true,
      ...config
    };
  }

  async connect(): Promise<void> {
    if (this.config.enableCompatMode) {
      this.isConnected = true;
    }
  }

  async disconnect(): Promise<void> {
    this.isConnected = false;
  }

  async executeTask(task: string, context?: OpenClawContext): Promise<any> {
    if (!this.isConnected) {
      throw new Error('OpenClaw compatibility adapter not connected');
    }

    return {
      success: true,
      result: `Task executed via OpenClaw compat: ${task}`,
      context
    };
  }

  async sendMessage(message: OpenClawMessage, sessionId: string): Promise<any> {
    return {
      success: true,
      messageId: `msg_${Date.now()}`,
      sessionId
    };
  }

  async getSession(sessionId: string): Promise<OpenClawContext | null> {
    return { sessionId };
  }

  isCompatModeEnabled(): boolean {
    return this.config.enableCompatMode ?? false;
  }
}

export default OpenClawCompatAdapter;