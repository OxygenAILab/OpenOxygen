/**
 * 技能注册表
 * 
 * 管理可用的自动化技能
 */

import { EventEmitter } from 'events';

export interface Skill {
  name: string;
  description: string;
  version: string;
  category: SkillCategory;
  parameters: ParameterDefinition[];
  returns: ReturnDefinition;
  examples: SkillExample[];
  execute: (params: any, context: SkillContext) => Promise<SkillResult>;
}

export type SkillCategory = 
  | 'system' 
  | 'gui' 
  | 'cli' 
  | 'browser' 
  | 'office' 
  | 'file' 
  | 'network'
  | 'data'
  | 'custom';

export interface ParameterDefinition {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'enum';
  description: string;
  required: boolean;
  default?: any;
  enumValues?: string[];
  items?: ParameterDefinition; // for array type
}

export interface ReturnDefinition {
  type: string;
  description: string;
  schema?: any;
}

export interface SkillExample {
  description: string;
  parameters: any;
  expectedOutput?: any;
}

export interface SkillContext {
  sessionId: string;
  workingDirectory: string;
  guiController?: any;
  cliExecutor?: any;
  memory: Map<string, any>;
  getScreenshot: () => Promise<string>;
  sendMessage: (type: string, data: any) => void;
}

export interface SkillResult {
  success: boolean;
  data?: any;
  error?: string;
  screenshot?: string;
  logs?: string[];
  metrics?: {
    durationMs: number;
    [key: string]: any;
  };
}

/**
 * 技能注册表
 */
export class SkillRegistry extends EventEmitter {
  private skills: Map<string, Skill> = new Map();
  private categories: Map<SkillCategory, Set<string>> = new Map();

  constructor() {
    super();
    this.registerBuiltInSkills();
  }

  /**
   * 注册技能
   */
  register(skill: Skill): void {
    if (this.skills.has(skill.name)) {
      throw new Error(`Skill '${skill.name}' is already registered`);
    }

    this.skills.set(skill.name, skill);
    
    // 添加到分类
    if (!this.categories.has(skill.category)) {
      this.categories.set(skill.category, new Set());
    }
    this.categories.get(skill.category)!.add(skill.name);

    this.emit('skillRegistered', skill);
  }

  /**
   * 注销技能
   */
  unregister(name: string): boolean {
    const skill = this.skills.get(name);
    if (!skill) return false;

    this.skills.delete(name);
    this.categories.get(skill.category)?.delete(name);

    this.emit('skillUnregistered', name);
    return true;
  }

  /**
   * 获取技能
   */
  get(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  /**
   * 检查技能是否存在
   */
  has(name: string): boolean {
    return this.skills.has(name);
  }

  /**
   * 获取所有技能名称
   */
  getAll(): string[] {
    return Array.from(this.skills.keys());
  }

  /**
   * 按分类获取技能
   */
  getByCategory(category: SkillCategory): string[] {
    return Array.from(this.categories.get(category) || []);
  }

  /**
   * 搜索技能
   */
  search(query: string): Skill[] {
    const lowerQuery = query.toLowerCase();
    return Array.from(this.skills.values()).filter(skill => 
      skill.name.toLowerCase().includes(lowerQuery) ||
      skill.description.toLowerCase().includes(lowerQuery) ||
      skill.category.toLowerCase().includes(lowerQuery)
    );
  }

  /**
   * 执行技能
   */
  async execute(name: string, params: any, context: SkillContext): Promise<SkillResult> {
    const skill = this.skills.get(name);
    if (!skill) {
      return {
        success: false,
        error: `Skill '${name}' not found`,
      };
    }

    // 验证参数
    const validation = this.validateParameters(skill, params);
    if (!validation.valid) {
      return {
        success: false,
        error: `Parameter validation failed: ${validation.error}`,
      };
    }

    const startTime = Date.now();
    
    try {
      this.emit('skillExecuting', { name, params });
      
      const result = await skill.execute(params, context);
      
      result.metrics = {
        ...result.metrics,
        durationMs: Date.now() - startTime,
      };

      this.emit('skillExecuted', { name, result });
      
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      this.emit('skillError', { name, error: errorMessage });
      
      return {
        success: false,
        error: errorMessage,
        metrics: { durationMs: Date.now() - startTime },
      };
    }
  }

  /**
   * 验证参数
   */
  private validateParameters(skill: Skill, params: any): { valid: boolean; error?: string } {
    for (const param of skill.parameters) {
      if (param.required && !(param.name in params)) {
        return { valid: false, error: `Missing required parameter: ${param.name}` };
      }

      if (param.name in params) {
        const value = params[param.name];
        const typeValid = this.checkType(value, param.type);
        
        if (!typeValid) {
          return { valid: false, error: `Invalid type for parameter ${param.name}: expected ${param.type}` };
        }

        if (param.enumValues && !param.enumValues.includes(value)) {
          return { valid: false, error: `Invalid value for parameter ${param.name}: must be one of ${param.enumValues.join(', ')}` };
        }
      }
    }

    return { valid: true };
  }

  /**
   * 检查类型
   */
  private checkType(value: any, type: string): boolean {
    switch (type) {
      case 'string': return typeof value === 'string';
      case 'number': return typeof value === 'number';
      case 'boolean': return typeof value === 'boolean';
      case 'array': return Array.isArray(value);
      case 'object': return typeof value === 'object' && !Array.isArray(value) && value !== null;
      case 'enum': return typeof value === 'string';
      default: return true;
    }
  }

  /**
   * 获取技能描述（用于 LLM）
   */
  getSkillDescriptions(): string {
    const descriptions: string[] = [];
    
    for (const [name, skill] of this.skills) {
      const params = skill.parameters.map(p => 
        `${p.name}: ${p.type}${p.required ? '' : '?'}`
      ).join(', ');
      
      descriptions.push(
        `${name}(${params}) - ${skill.description}`
      );
    }
    
    return descriptions.join('\n');
  }

  /**
   * 获取技能定义（用于 Tool Calling）
   */
  getToolDefinitions(): any[] {
    return Array.from(this.skills.values()).map(skill => ({
      type: 'function',
      function: {
        name: skill.name,
        description: skill.description,
        parameters: {
          type: 'object',
          properties: Object.fromEntries(
            skill.parameters.map(p => [
              p.name,
              {
                type: p.type === 'enum' ? 'string' : p.type,
                description: p.description,
                enum: p.enumValues,
                ...(p.items && { items: { type: p.items.type } }),
              }
            ])
          ),
          required: skill.parameters.filter(p => p.required).map(p => p.name),
        },
      },
    }));
  }

  /**
   * 注册内置技能
   */
  private registerBuiltInSkills(): void {
    // 导入内置技能
    const { allBuiltinSkills } = require('./builtin');
    
    for (const skill of allBuiltinSkills) {
      this.register(skill);
    }
  }

  /**
   * 创建技能上下文
   */
  createContext(
    sessionId: string,
    workingDirectory: string,
    guiController?: any,
    cliExecutor?: any,
    browserController?: any,
  ): SkillContext {
    return {
      sessionId,
      workingDirectory,
      guiController,
      cliExecutor,
      browserController,
      memory: new Map(),
      getScreenshot: async () => {
        if (guiController) {
          return guiController.screenshot();
        }
        return '';
      },
      sendMessage: (type: string, data: any) => {
        this.emit('message', { type, data });
      },
    };
  }

  /**
   * 注册系统技能
   */
  private registerSystemSkills(): void {
    this.register({
      name: 'wait',
      description: 'Wait for a specified duration',
      version: '1.0.0',
      category: 'system',
      parameters: [
        {
          name: 'durationMs',
          type: 'number',
          description: 'Duration to wait in milliseconds',
          required: true,
        },
      ],
      returns: { type: 'void', description: 'Waits and returns when duration is complete' },
      examples: [
        { description: 'Wait for 1 second', parameters: { durationMs: 1000 } },
      ],
      execute: async (params) => {
        await new Promise(resolve => setTimeout(resolve, params.durationMs));
        return { success: true };
      },
    });

    this.register({
      name: 'getSystemInfo',
      description: 'Get system information',
      version: '1.0.0',
      category: 'system',
      parameters: [],
      returns: { type: 'object', description: 'System information including OS, memory, etc.' },
      examples: [],
      execute: async () => {
        return {
          success: true,
          data: {
            platform: process.platform,
            arch: process.arch,
            nodeVersion: process.version,
            cwd: process.cwd(),
          },
        };
      },
    });
  }

  /**
   * 注册 GUI 技能
   */
  private registerGuiSkills(): void {
    this.register({
      name: 'gui_click',
      description: 'Click on a GUI element',
      version: '1.0.0',
      category: 'gui',
      parameters: [
        { name: 'x', type: 'number', description: 'X coordinate', required: true },
        { name: 'y', type: 'number', description: 'Y coordinate', required: true },
        { name: 'button', type: 'enum', description: 'Mouse button', required: false, default: 'left', enumValues: ['left', 'right', 'middle'] },
      ],
      returns: { type: 'object', description: 'Click result with screenshot' },
      examples: [],
      execute: async (params, context) => {
        if (!context.guiController) {
          return { success: false, error: 'GUI controller not available' };
        }
        // Implementation would use context.guiController
        return { success: true, data: { x: params.x, y: params.y } };
      },
    });

    this.register({
      name: 'gui_type',
      description: 'Type text at the current cursor location',
      version: '1.0.0',
      category: 'gui',
      parameters: [
        { name: 'text', type: 'string', description: 'Text to type', required: true },
        { name: 'interval', type: 'number', description: 'Interval between keystrokes in ms', required: false, default: 10 },
      ],
      returns: { type: 'object', description: 'Type result' },
      examples: [],
      execute: async (params, context) => {
        if (!context.guiController) {
          return { success: false, error: 'GUI controller not available' };
        }
        return { success: true, data: { text: params.text } };
      },
    });

    this.register({
      name: 'gui_screenshot',
      description: 'Capture a screenshot',
      version: '1.0.0',
      category: 'gui',
      parameters: [
        { name: 'region', type: 'object', description: 'Screen region to capture (x, y, width, height)', required: false },
        { name: 'format', type: 'enum', description: 'Screenshot format', required: false, default: 'png', enumValues: ['png', 'jpeg'] },
      ],
      returns: { type: 'string', description: 'Base64 encoded screenshot' },
      examples: [],
      execute: async (params, context) => {
        if (!context.guiController) {
          return { success: false, error: 'GUI controller not available' };
        }
        const screenshot = await context.getScreenshot();
        return { success: true, data: screenshot, screenshot };
      },
    });
  }

  /**
   * 注册 CLI 技能
   */
  private registerCliSkills(): void {
    this.register({
      name: 'cli_execute',
      description: 'Execute a shell command',
      version: '1.0.0',
      category: 'cli',
      parameters: [
        { name: 'command', type: 'string', description: 'Command to execute', required: true },
        { name: 'cwd', type: 'string', description: 'Working directory', required: false },
        { name: 'timeout', type: 'number', description: 'Timeout in milliseconds', required: false, default: 60000 },
      ],
      returns: { type: 'object', description: 'Command output and exit code' },
      examples: [],
      execute: async (params, context) => {
        if (!context.cliExecutor) {
          return { success: false, error: 'CLI executor not available' };
        }
        // Implementation would use context.cliExecutor
        return { success: true, data: { command: params.command } };
      },
    });
  }

  /**
   * 注册文件技能
   */
  private registerFileSkills(): void {
    this.register({
      name: 'file_read',
      description: 'Read file contents',
      version: '1.0.0',
      category: 'file',
      parameters: [
        { name: 'path', type: 'string', description: 'File path', required: true },
        { name: 'encoding', type: 'enum', description: 'File encoding', required: false, default: 'utf-8', enumValues: ['utf-8', 'ascii', 'base64'] },
      ],
      returns: { type: 'string', description: 'File contents' },
      examples: [],
      execute: async (params) => {
        try {
          const fs = await import('fs/promises');
          const content = await fs.readFile(params.path, { encoding: params.encoding });
          return { success: true, data: content };
        } catch (error) {
          return { success: false, error: String(error) };
        }
      },
    });

    this.register({
      name: 'file_write',
      description: 'Write content to file',
      version: '1.0.0',
      category: 'file',
      parameters: [
        { name: 'path', type: 'string', description: 'File path', required: true },
        { name: 'content', type: 'string', description: 'Content to write', required: true },
        { name: 'append', type: 'boolean', description: 'Append to file instead of overwrite', required: false, default: false },
      ],
      returns: { type: 'void', description: 'Writes file and returns success' },
      examples: [],
      execute: async (params) => {
        try {
          const fs = await import('fs/promises');
          const flag = params.append ? 'a' : 'w';
          await fs.writeFile(params.path, params.content, { flag });
          return { success: true };
        } catch (error) {
          return { success: false, error: String(error) };
        }
      },
    });
  }
}
