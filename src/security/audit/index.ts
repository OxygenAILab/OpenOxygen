export type AuditLevel = 'info' | 'warning' | 'error' | 'critical';

export type AuditAction = 
  | 'task_start'
  | 'task_complete'
  | 'task_failed'
  | 'skill_executed'
  | 'permission_granted'
  | 'permission_denied'
  | 'memory_read'
  | 'memory_write'
  | 'network_request'
  | 'system_command'
  | 'file_access'
  | 'reflection'
  | 'model_switch';

export interface AuditEntry {
  id: string;
  timestamp: number;
  level: AuditLevel;
  action: AuditAction;
  taskId?: string;
  userId?: string;
  details: Record<string, any>;
  success?: boolean;
  error?: string;
}

export interface AuditQuery {
  level?: AuditLevel;
  action?: AuditAction;
  taskId?: string;
  userId?: string;
  startTime?: number;
  endTime?: number;
  limit?: number;
}

export class AuditLogger {
  private entries: AuditEntry[] = [];
  private maxEntries = 10000;
  private nextId = 1;

  log(
    level: AuditLevel,
    action: AuditAction,
    details: Record<string, any>,
    options?: { taskId?: string; userId?: string; success?: boolean; error?: string }
  ): AuditEntry {
    const entry: AuditEntry = {
      id: `audit_${this.nextId++}`,
      timestamp: Date.now(),
      level,
      action,
      details,
      ...options,
    };

    this.entries.push(entry);

    if (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }

    return entry;
  }

  info(action: AuditAction, details: Record<string, any>, options?: { taskId?: string; userId?: string }): AuditEntry {
    return this.log('info', action, details, options);
  }

  warning(action: AuditAction, details: Record<string, any>, options?: { taskId?: string; userId?: string; error?: string }): AuditEntry {
    return this.log('warning', action, details, options);
  }

  error(action: AuditAction, details: Record<string, any>, options?: { taskId?: string; userId?: string; error?: string }): AuditEntry {
    return this.log('error', action, details, options);
  }

  critical(action: AuditAction, details: Record<string, any>, options?: { taskId?: string; userId?: string; error?: string }): AuditEntry {
    return this.log('critical', action, details, options);
  }

  query(options: AuditQuery): AuditEntry[] {
    let results = [...this.entries];

    if (options.level) {
      results = results.filter(e => e.level === options.level);
    }

    if (options.action) {
      results = results.filter(e => e.action === options.action);
    }

    if (options.taskId) {
      results = results.filter(e => e.taskId === options.taskId);
    }

    if (options.userId) {
      results = results.filter(e => e.userId === options.userId);
    }

    if (options.startTime) {
      results = results.filter(e => e.timestamp >= options.startTime);
    }

    if (options.endTime) {
      results = results.filter(e => e.timestamp <= options.endTime);
    }

    results.sort((a, b) => b.timestamp - a.timestamp);

    if (options.limit) {
      results = results.slice(0, options.limit);
    }

    return results;
  }

  getRecent(count: number = 50): AuditEntry[] {
    return [...this.entries]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, count);
  }

  getStats(): {
    total: number;
    byLevel: Record<AuditLevel, number>;
    byAction: Record<AuditAction, number>;
    lastHour: number;
  } {
    const byLevel: Record<AuditLevel, number> = { info: 0, warning: 0, error: 0, critical: 0 };
    const byAction: Record<AuditAction, number> = {} as Record<AuditAction, number>;
    const lastHour = Date.now() - 3600000;
    let lastHourCount = 0;

    for (const entry of this.entries) {
      byLevel[entry.level]++;
      byAction[entry.action] = (byAction[entry.action] || 0) + 1;
      if (entry.timestamp > lastHour) {
        lastHourCount++;
      }
    }

    return {
      total: this.entries.length,
      byLevel,
      byAction,
      lastHour: lastHourCount,
    };
  }

  exportEntries(options?: AuditQuery): AuditEntry[] {
    return this.query(options);
  }
}

export default AuditLogger;