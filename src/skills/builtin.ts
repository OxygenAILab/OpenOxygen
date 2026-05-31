/**
 * 内置技能实现
 * 
 * 核心自动化技能的具体实现
 */

import { Skill, SkillContext, SkillResult, ParameterDefinition } from './registry';
import { TaskRequest, TaskResponse } from '../orchestrator';

// GUI 技能
export const guiSkills: Skill[] = [
  {
    name: 'gui_click',
    description: '点击屏幕上的指定坐标或元素',
    version: '1.0.0',
    category: 'gui',
    parameters: [
      { name: 'x', type: 'number', description: 'X 坐标', required: true },
      { name: 'y', type: 'number', description: 'Y 坐标', required: true },
      { name: 'button', type: 'enum', description: '鼠标按钮', required: false, default: 'left', enumValues: ['left', 'right', 'middle'] },
    ],
    returns: { type: 'object', description: '点击结果' },
    examples: [
      { description: '点击 (100, 200)', parameters: { x: 100, y: 200 } },
    ],
    async execute(params, context) {
      if (!context.guiController) {
        return { success: false, error: 'GUI controller not available' };
      }
      
      const x = params.x as number;
      const y = params.y as number;
      const button = (params.button as string) || 'left';
      
      try {
        const result = await context.guiController.click(x, y);
        return {
          success: result.success,
          output: result,
          screenshot: result.screenshot_after,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  },

  {
    name: 'gui_type',
    description: '在指定位置输入文本',
    version: '1.0.0',
    category: 'gui',
    parameters: [
      { name: 'text', type: 'string', description: '要输入的文本', required: true },
      { name: 'x', type: 'number', description: 'X 坐标（可选）', required: false },
      { name: 'y', type: 'number', description: 'Y 坐标（可选）', required: false },
      { name: 'clear_first', type: 'boolean', description: '先清空现有文本', required: false, default: false },
    ],
    returns: { type: 'object', description: '输入结果' },
    examples: [],
    async execute(params, context) {
      if (!context.guiController) {
        return { success: false, error: 'GUI controller not available' };
      }
      
      const text = params.text as string;
      const x = params.x as number | undefined;
      const y = params.y as number | undefined;
      
      try {
        if (x !== undefined && y !== undefined) {
          // 先点击
          await context.guiController.click(x, y);
          
          if (params.clear_first) {
            await context.guiController.key_press('ctrl+a');
            await context.guiController.key_press('delete');
          }
        }
        
        const result = await context.guiController.type_text(text);
        return { success: result.success };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  },

  {
    name: 'gui_screenshot',
    description: '捕获屏幕截图',
    version: '1.0.0',
    category: 'gui',
    parameters: [
      { name: 'region', type: 'object', description: '区域 {x, y, width, height}', required: false },
    ],
    returns: { type: 'string', description: 'Base64 编码的截图' },
    examples: [],
    async execute(params, context) {
      if (!context.guiController) {
        return { success: false, error: 'GUI controller not available' };
      }
      
      try {
        const screenshot = await context.guiController.screenshot();
        context.sendMessage('screenshot', { screenshot });
        
        return {
          success: true,
          output: { screenshot },
          screenshot,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  },

  {
    name: 'gui_find_element',
    description: '通过描述查找 UI 元素',
    version: '1.0.0',
    category: 'gui',
    parameters: [
      { name: 'description', type: 'string', description: '元素描述', required: true },
    ],
    returns: { type: 'object', description: '元素信息' },
    examples: [],
    async execute(params, context) {
      if (!context.guiController) {
        return { success: false, error: 'GUI controller not available' };
      }
      
      try {
        const element = await context.guiController.find_element(params.description as string);
        return {
          success: true,
          output: element,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  },

  {
    name: 'gui_wait_for',
    description: '等待元素出现',
    version: '1.0.0',
    category: 'gui',
    parameters: [
      { name: 'description', type: 'string', description: '元素描述', required: true },
      { name: 'timeout', type: 'number', description: '超时时间（毫秒）', required: false, default: 30000 },
    ],
    returns: { type: 'object', description: '元素信息' },
    examples: [],
    async execute(params, context) {
      if (!context.guiController) {
        return { success: false, error: 'GUI controller not available' };
      }
      
      try {
        const element = await context.guiController.wait_for_element(
          params.description as string,
          (params.timeout as number) || 30000
        );
        return {
          success: true,
          output: element,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  },
];

// CLI 技能
export const cliSkills: Skill[] = [
  {
    name: 'cli_execute',
    description: '执行命令行命令',
    version: '1.0.0',
    category: 'cli',
    parameters: [
      { name: 'command', type: 'string', description: '命令', required: true },
      { name: 'cwd', type: 'string', description: '工作目录', required: false },
      { name: 'timeout', type: 'number', description: '超时时间（毫秒）', required: false, default: 60000 },
    ],
    returns: { type: 'object', description: '执行结果' },
    examples: [
      { description: '列出目录', parameters: { command: 'ls -la' } },
    ],
    async execute(params, context) {
      if (!context.cliExecutor) {
        return { success: false, error: 'CLI executor not available' };
      }
      
      try {
        const result = await context.cliExecutor.execute({
          command: params.command as string,
          cwd: params.cwd as string | undefined,
          timeout: (params.timeout as number) || 60000,
          captureOutput: true,
        });
        
        return {
          success: result.success && result.exit_code === 0,
          output: {
            exit_code: result.exit_code,
            stdout: result.stdout,
            stderr: result.stderr,
          },
          logs: [result.stdout, result.stderr].filter(Boolean),
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  },

  {
    name: 'cli_spawn',
    description: '启动后台进程',
    version: '1.0.0',
    category: 'cli',
    parameters: [
      { name: 'command', type: 'string', description: '命令', required: true },
      { name: 'cwd', type: 'string', description: '工作目录', required: false },
    ],
    returns: { type: 'object', description: '进程信息' },
    examples: [],
    async execute(params, context) {
      if (!context.cliExecutor) {
        return { success: false, error: 'CLI executor not available' };
      }
      
      try {
        const processId = await context.cliExecutor.spawn({
          command: params.command as string,
          cwd: params.cwd as string | undefined,
        });
        
        return {
          success: true,
          output: { process_id: processId },
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  },
];

// 浏览器技能
export const browserSkills: Skill[] = [
  {
    name: 'browser_navigate',
    description: '导航到 URL',
    version: '1.0.0',
    category: 'browser',
    parameters: [
      { name: 'url', type: 'string', description: '目标 URL', required: true },
    ],
    returns: { type: 'object', description: '导航结果' },
    examples: [
      { description: '打开 Google', parameters: { url: 'https://google.com' } },
    ],
    async execute(params, context) {
      if (!context.browserController) {
        return { success: false, error: 'Browser controller not available' };
      }
      
      try {
        const result = await context.browserController.navigate(params.url as string);
        return {
          success: result.success,
          output: {
            url: result.url,
            title: result.title,
          },
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  },

  {
    name: 'browser_click',
    description: '点击网页元素',
    version: '1.0.0',
    category: 'browser',
    parameters: [
      { name: 'selector', type: 'string', description: 'CSS 选择器', required: true },
    ],
    returns: { type: 'object', description: '点击结果' },
    examples: [],
    async execute(params, context) {
      if (!context.browserController) {
        return { success: false, error: 'Browser controller not available' };
      }
      
      try {
        const result = await context.browserController.click(params.selector as string);
        return {
          success: result.success,
          output: result,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  },

  {
    name: 'browser_type',
    description: '在网页元素中输入文本',
    version: '1.0.0',
    category: 'browser',
    parameters: [
      { name: 'selector', type: 'string', description: 'CSS 选择器', required: true },
      { name: 'text', type: 'string', description: '要输入的文本', required: true },
    ],
    returns: { type: 'object', description: '输入结果' },
    examples: [],
    async execute(params, context) {
      if (!context.browserController) {
        return { success: false, error: 'Browser controller not available' };
      }
      
      try {
        const result = await context.browserController.type_text(
          params.selector as string,
          params.text as string
        );
        return {
          success: result.success,
          output: result,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  },
];

// 系统技能
export const systemSkills: Skill[] = [
  {
    name: 'wait',
    description: '等待指定时间',
    version: '1.0.0',
    category: 'system',
    parameters: [
      { name: 'duration_ms', type: 'number', description: '等待时间（毫秒）', required: true },
    ],
    returns: { type: 'void', description: '等待完成' },
    examples: [
      { description: '等待 1 秒', parameters: { duration_ms: 1000 } },
    ],
    async execute(params) {
      const duration = params.duration_ms as number;
      await new Promise(resolve => setTimeout(resolve, duration));
      return { success: true };
    },
  },

  {
    name: 'memory_store',
    description: '存储到记忆',
    version: '1.0.0',
    category: 'memory',
    parameters: [
      { name: 'key', type: 'string', description: '键', required: true },
      { name: 'value', type: 'any', description: '值', required: true },
      { name: 'scope', type: 'enum', description: '作用域', required: false, default: 'task', enumValues: ['task', 'session', 'global'] },
    ],
    returns: { type: 'object', description: '存储结果' },
    examples: [],
    async execute(params, context) {
      const key = params.key as string;
      const value = params.value;
      const scope = (params.scope as string) || 'task';
      
      try {
        if (scope === 'global') {
          context.memory.set(`global:${key}`, value);
        } else if (scope === 'session') {
          context.memory.set(`session:${key}`, value);
        } else {
          context.memory.set(key, value);
        }
        
        return { success: true, output: { key, scope } };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  },

  {
    name: 'memory_retrieve',
    description: '从记忆检索',
    version: '1.0.0',
    category: 'memory',
    parameters: [
      { name: 'key', type: 'string', description: '键', required: true },
      { name: 'scope', type: 'enum', description: '作用域', required: false, default: 'task', enumValues: ['task', 'session', 'global'] },
    ],
    returns: { type: 'any', description: '存储的值' },
    examples: [],
    async execute(params, context) {
      const key = params.key as string;
      const scope = (params.scope as string) || 'task';
      
      try {
        let value;
        if (scope === 'global') {
          value = context.memory.get(`global:${key}`);
        } else if (scope === 'session') {
          value = context.memory.get(`session:${key}`);
        } else {
          value = context.memory.get(key);
        }
        
        return {
          success: true,
          output: { key, value, scope },
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  },
];

// 导出所有内置技能
export const allBuiltinSkills: Skill[] = [
  ...guiSkills,
  ...cliSkills,
  ...browserSkills,
  ...systemSkills,
];

// 技能分类
export const skillCategories = {
  gui: guiSkills,
  cli: cliSkills,
  browser: browserSkills,
  system: systemSkills,
};

// 技能工厂
export function createSkillRegistry(): void {
  // 技能注册逻辑在 registry.ts 中
}
