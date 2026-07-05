#!/usr/bin/env node
/**
 * OpenOxygen 2.0
 * 
 * Next-generation Computer Use Agent Framework
 */

import { TaskOrchestrator, TaskRequest, TaskResponse } from './orchestrator';
import { LLMGateway, LLMConfig } from './llm/gateway';
import { SkillRegistry } from './skills/registry';
import { WindowsGuiController } from './gui/windows';
import { NodeCliExecutor } from './cli/executor';
import { PlaywrightController, BrowserOptions } from './browser/controller';
import { FileSystemManager } from './fs/manager';
import { OxygenMemo } from './memory/engine';
import { AgentRegistry, AgentCollaborationMode, OpenOxygenAgent } from './agents/registry';

export * from './orchestrator';
export * from './llm/gateway';
export * from './skills/registry';
export * from './agents/registry';

export interface OpenOxygenConfig {
  llm: LLMConfig;
  workingDirectory?: string;
  enableGui?: boolean;
  enableCli?: boolean;
  enableBrowser?: boolean;
  browserOptions?: BrowserOptions;
  memoryStoragePath?: string;
  memoryTlbSize?: number;
  maxRetries?: number;
  enableReflection?: boolean;
  mode?: string;
  priority?: string;
}

/**
 * OpenOxygen 主类
 */
export class OpenOxygen {
  private orchestrator: TaskOrchestrator;
  private llm: LLMGateway;
  private skills: SkillRegistry;
  private gui: WindowsGuiController;
  private cli: NodeCliExecutor;
  private browser: PlaywrightController;
  private fs: FileSystemManager;
  private memory: OxygenMemo;
  private agents: AgentRegistry;
  private config: OpenOxygenConfig;

  constructor(config: OpenOxygenConfig) {
    this.config = config;
    this.llm = new LLMGateway(config.llm);
    this.skills = new SkillRegistry();
    this.gui = new WindowsGuiController();
    this.cli = new NodeCliExecutor();
    this.browser = new PlaywrightController(config.browserOptions || {});
    this.fs = new FileSystemManager();
    this.memory = new OxygenMemo(
      config.memoryStoragePath || './memory_store',
      config.memoryTlbSize || 5
    );
    this.agents = new AgentRegistry();
    this.registerDefaultAgents();
    
    this.orchestrator = new TaskOrchestrator({
      llmGateway: this.llm,
      guiController: this.gui,
      cliExecutor: this.cli,
      browserController: this.browser,
      fileSystemManager: this.fs,
      memoryEngine: this.memory,
      maxRetries: config.maxRetries ?? 3,
      enableReflection: config.enableReflection ?? true,
    });
  }

  /**
   * 执行自然语言任务
   * 
   * @example
   * ```typescript
   * const agent = new OpenOxygen({
   *   llm: {
   *     provider: 'openai',
   *     apiKey: process.env.OPENAI_API_KEY,
   *     model: 'gpt-4'
   *   }
   * });
   * 
   * const result = await agent.execute({
   *   description: 'Open Chrome and search for "OpenAI"'
   * });
   * ```
   */
  async execute(request: TaskRequest): Promise<TaskResponse> {
    return this.orchestrator.execute(request);
  }

  /**
   * 让 LLM 直接与用户对话
   */
  async chat(prompt: string, system?: string): Promise<string> {
    const response = await this.llm.complete({ prompt, system });
    return response.content;
  }

  /**
   * 注册协作 Agent
   */
  registerAgent(agent: OpenOxygenAgent): void {
    this.agents.register(agent);
  }

  /**
   * 多 Agent 协作执行
   */
  async collaborate(task: string, mode: AgentCollaborationMode = 'sequential', capabilities?: string[]) {
    return this.agents.collaborate({ task, mode, requiredCapabilities: capabilities });
  }

  /**
   * 获取 Agent 列表
   */
  getAgents() {
    return this.agents.list();
  }

  /**
   * 流式执行任务
   */
  async *executeStream(request: TaskRequest): AsyncGenerator<any> {
    yield* this.orchestrator.executeStream(request);
  }

  /**
   * 注册自定义技能
   */
  registerSkill(skill: any): void {
    this.skills.register(skill);
  }

  /**
   * 获取技能列表
   */
  getSkills(): string[] {
    return this.skills.getAll();
  }

  /**
   * 获取 LLM 统计
   */
  getLLMStats() {
    return this.llm.getStats();
  }

  /**
   * 获取浏览器控制器
   */
  getBrowser(): PlaywrightController {
    return this.browser;
  }

  /**
   * 获取文件系统管理器
   */
  getFileSystem(): FileSystemManager {
    return this.fs;
  }

  /**
   * 获取记忆系统
   */
  getMemory(): OxygenMemo {
    return this.memory;
  }

  private registerDefaultAgents(): void {
    this.agents.register({
      id: 'openoxygen-executor',
      name: 'OpenOxygen Executor',
      description: '使用 OpenOxygen 编排器执行 GUI、CLI、浏览器、文件系统与记忆任务',
      capabilities: [
        { name: 'execute', score: 10 },
        { name: 'gui', score: 8 },
        { name: 'cli', score: 8 },
        { name: 'browser', score: 8 },
        { name: 'filesystem', score: 7 },
        { name: 'memory', score: 7 },
      ],
      execute: async message => {
        const result = await this.execute({
          description: message.task,
          context: typeof message.context === 'string' ? message.context : JSON.stringify(message.context || {}),
          mode: 'auto',
        });
        return {
          agentId: 'openoxygen-executor',
          success: result.status === 'completed',
          output: result,
          score: result.status === 'completed' ? 1 : 0,
        };
      },
    });

    this.agents.register({
      id: 'llm-chat',
      name: 'LLM Chat Agent',
      description: '通过当前 LLM provider 进行问答、解释、规划与总结',
      capabilities: [
        { name: 'chat', score: 10 },
        { name: 'reasoning', score: 8 },
        { name: 'summarize', score: 7 },
        { name: 'planning', score: 7 },
      ],
      execute: async message => ({
        agentId: 'llm-chat',
        success: true,
        output: await this.chat(message.task, message.context?.system),
        score: 1,
      }),
    });
  }

  /**
   * 清理资源
   */
  async dispose(): Promise<void> {
    await this.orchestrator.dispose();
    await this.cli.dispose();
    await this.browser.close();
  }
}

// 默认导出
export default OpenOxygen;

// CLI 入口点
if (require.main === module) {
  (async () => {
    const { Command } = require('commander');
    const readline = require('readline');
    const program = new Command();

    const createConfig = (options: any = {}): OpenOxygenConfig => {
      const provider = options.provider || process.env.OPENOXYGEN_PROVIDER || process.env.LLM_PROVIDER || 'ollama';
      const method = options.method || process.env.OPENOXYGEN_METHOD;
      const baseURL = options.url || process.env.OPENOXYGEN_BASE_URL || process.env.OPENAI_BASE_URL || process.env.ANTHROPIC_BASE_URL;
      const apiKey = options.key || process.env.OPENOXYGEN_API_KEY || process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || '';
      const model = options.model || process.env.OPENOXYGEN_MODEL || process.env.OPENAI_MODEL || process.env.ANTHROPIC_MODEL || 'aikid123/qwen3-coder:latest';

      return {
        llm: {
          provider: (method === 'OpenAIAPI' ? 'openai' : provider) as LLMConfig['provider'],
          apiKey,
          baseURL,
          model,
        },
        mode: options.mode,
        priority: options.priority,
      };
    };

    const withAgent = async (options: any, fn: (agent: OpenOxygen) => Promise<void>) => {
      const agent = new OpenOxygen(createConfig(options));
      try {
        await fn(agent);
      } finally {
        await agent.dispose();
      }
    };

    const addLlmOptions = (cmd: any) => cmd
      .option('--provider <provider>', 'LLM provider: ollama, openai, anthropic', process.env.OPENOXYGEN_PROVIDER)
      .option('--model <model>', 'LLM model name', process.env.OPENOXYGEN_MODEL)
      .option('--url <url>', 'LLM API base URL', process.env.OPENOXYGEN_BASE_URL)
      .option('--key <key>', 'LLM API key', process.env.OPENOXYGEN_API_KEY)
      .option('--method <method>', 'Compatibility method, e.g. OpenAIAPI', process.env.OPENOXYGEN_METHOD);

    program
      .name('openoxygen')
      .description('OpenOxygen v26 alpha - Computer Use Agent')
      .version('26.0.0-alpha.1');

    addLlmOptions(program.command('chat')
      .description('Chat with Ollama/OpenAI-compatible/Anthropic LLM')
      .argument('<prompt>', 'Prompt'))
      .action(async (prompt: string, options: any) => {
        await withAgent(options, async agent => {
          console.log(await agent.chat(prompt));
        });
      });

    addLlmOptions(program.command('execute')
      .description('Let LLM plan and execute an OpenOxygen task')
      .argument('<task>', 'Task description')
      .option('-m, --mode <mode>', 'Execution mode: auto, gui, cli', 'auto')
      .option('-p, --priority <priority>', 'Task priority', 'normal'))
      .action(async (task: string, options: any) => {
        await withAgent(options, async agent => {
          const result = await agent.execute({
            description: task,
            mode: options.mode,
            priority: options.priority,
          });
          console.log(JSON.stringify({ status: result.status, taskId: result.taskId, summary: result.summary }, null, 2));
        });
      });

    addLlmOptions(program.command('collaborate')
      .description('Run a task through multi-agent collaboration')
      .argument('<task>', 'Task description')
      .option('--mode <mode>', 'parallel, sequential, voting', 'sequential')
      .option('--capabilities <items>', 'Comma-separated capability filters'))
      .action(async (task: string, options: any) => {
        await withAgent(options, async agent => {
          const capabilities = options.capabilities?.split(',').map((s: string) => s.trim()).filter(Boolean);
          const results = await agent.collaborate(task, options.mode, capabilities);
          console.log(JSON.stringify(results, null, 2));
        });
      });

    addLlmOptions(program.command('interactive')
      .description('Start interactive chat/task mode')
      .option('--execute', 'Execute each input as an OpenOxygen task instead of plain chat'))
      .action(async (options: any) => {
        await withAgent(options, async agent => {
          console.log('OpenOxygen v26 alpha interactive. 输入 exit 退出。');
          const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
          const ask = () => new Promise<string>(resolve => rl.question('> ', resolve));
          while (true) {
            const input = (await ask()).trim();
            if (!input || input.toLowerCase() === 'exit') break;
            if (options.execute) {
              const result = await agent.execute({ description: input, mode: 'auto' });
              console.log(result.summary || result.status);
            } else {
              console.log(await agent.chat(input));
            }
          }
          rl.close();
        });
      });

    program
      .command('agents')
      .description('List built-in agents and capabilities')
      .action(async () => {
        await withAgent({}, async agent => {
          console.log(JSON.stringify(agent.getAgents(), null, 2));
        });
      });

    program.parse();
  })().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
