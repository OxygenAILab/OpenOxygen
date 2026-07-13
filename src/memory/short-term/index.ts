export interface ShortTermMemoryEntry {
  key: string;
  value: any;
  timestamp: number;
  expiresAt?: number;
  scope: 'task' | 'session' | 'global';
}

export interface SessionContext {
  sessionId: string;
  userId?: string;
  startTime: number;
  messages: ChatMessage[];
  taskResults: Record<string, any>;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: number;
}

export class ShortTermMemory {
  private store = new Map<string, ShortTermMemoryEntry>();
  private defaultTTL = 3600000;

  set(key: string, value: any, scope: ShortTermMemoryEntry['scope'] = 'task', ttlMs?: number): void {
    const entry: ShortTermMemoryEntry = {
      key,
      value,
      timestamp: Date.now(),
      scope,
      expiresAt: Date.now() + (ttlMs || this.defaultTTL)
    };
    
    this.store.set(key, entry);
  }

  get(key: string): any {
    const entry = this.store.get(key);
    
    if (!entry) return undefined;
    
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    
    return entry.value;
  }

  delete(key: string): boolean {
    return this.store.delete(key);
  }

  has(key: string): boolean {
    const entry = this.store.get(key);
    
    if (!entry) return false;
    
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return false;
    }
    
    return true;
  }

  getByScope(scope: ShortTermMemoryEntry['scope']): ShortTermMemoryEntry[] {
    return Array.from(this.store.values()).filter(entry => entry.scope === scope);
  }

  clearScope(scope: ShortTermMemoryEntry['scope']): void {
    for (const [key, entry] of this.store.entries()) {
      if (entry.scope === scope) {
        this.store.delete(key);
      }
    }
  }

  clear(): void {
    this.store.clear();
  }

  getAll(): ShortTermMemoryEntry[] {
    return Array.from(this.store.values());
  }

  getSnapshot(): Record<string, any> {
    const snapshot: Record<string, any> = {};
    
    for (const [key, entry] of this.store) {
      if (!entry.expiresAt || Date.now() <= entry.expiresAt) {
        snapshot[key] = entry.value;
      }
    }
    
    return snapshot;
  }

  loadSnapshot(snapshot: Record<string, any>): void {
    this.store.clear();
    
    for (const [key, value] of Object.entries(snapshot)) {
      this.set(key, value);
    }
  }

  getStats(): { total: number; byScope: Record<string, number> } {
    const byScope: Record<string, number> = { task: 0, session: 0, global: 0 };
    
    for (const entry of this.store.values()) {
      byScope[entry.scope]++;
    }
    
    return {
      total: this.store.size,
      byScope
    };
  }
}

export default ShortTermMemory;