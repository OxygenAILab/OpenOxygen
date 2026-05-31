/**
 * OpenOxygen 2.0
 * 
 * Next-generation Computer Use Agent Framework
 */

import { TaskOrchestrator, TaskRequest, TaskResponse } from './orchestrator';
import { LLMGateway, LLMConfig } from './llm/gateway';
import { SkillRegistry } from './skills/registry';

export * from './orchestrator';
export * from './llm/gateway';
export * from './skills/registry';

export interface OpenOxygenConfig {
  llm: LLMConfig;
  workingDirectory?: string;
  enableGui?: boolean;
  enableCli?: boolean;
  maxRetries?: number;
  enableReflection?: boolean;
}

/**
 * OpenOxygen 主类
 */
export class OpenOxygen {
  private orchestrator: TaskOrchestrator;
  private llm: LLMGateway;
  private skills: SkillRegistry;
  private config: OpenOxygenConfig;

  constructor(config: OpenOxygenConfig) {
    this.config = config;
    this.llm = new LLMGateway(config.llm);
    this.skills = new SkillRegistry();
    
    this.orchestrator = new TaskOrchestrator({
      llmGateway: this.llm,
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
   * 清理资源
   */
  async dispose(): Promise<void> {
    await this.orchestrator.dispose();
  }
}

// 默认导出
export default OpenOxygen;

// CLI 入口点
if (require.main === module) {
  (async () => {
    const { Command } = require('commander');
    const program = new Command();

    program
      .name('openoxygen')
      .description('OpenOxygen 2.0 - Computer Use Agent')
      .version('2.0.0');

    program
      .command('execute')
      .description('Execute a natural language task')
      .argument('<task>', 'Task description')
      .option('-m, --mode <mode>', 'Execution mode: auto, gui, cli', 'auto')
      .option('-p, --priority <priority>', 'Task priority', 'normal')
      .action(async (task: string, options: any) => {
        console.log('🚀 OpenOxygen 2.0');
        console.log(`Task: ${task}`);
        console.log(`Mode: ${options.mode}`);
        
        // TODO: 从配置文件或环境变量读取 LLM 配置
        const config: OpenOxygenConfig = {
          llm: {
            provider: 'openai',
            apiKey: process.env.OPENAI_API_KEY || '',
            model: process.env.OPENAI_MODEL || 'gpt-4',
          },
          mode: options.mode,
          priority: options.priority,
        };

        const agent = new OpenOxygen(config);
        
        try {
          const result = await agent.execute({
            description: task,
            mode: options.mode,
            priority: options.priority,
          });

          console.log('\n✅ Task completed');
          console.log(`Status: ${result.status}`);
          if (result.summary) {
            console.log(`Summary: ${result.summary}`);
          }
        } catch (error) {
          console.error('\n❌ Task failed:', error);
          process.exit(1);
        } finally {
          await agent.dispose();
        }
      });

    program
      .command('interactive')
      .description('Start interactive mode')
      .action(async () => {
        console.log('🚀 OpenOxygen 2.0 - Interactive Mode');
        console.log('Type "exit" to quit\n');

        const readline = require('readline');
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });

        const askQuestion = () => {
          rl.question('> ', async (input: string) => {
            if (input.toLowerCase() === 'exit') {
              rl.close();
              return;
            }

            console.log('Processing...\n');
            
            // TODO: Execute task
            console.log('✅ Done\n');
            
            askQuestion();
          });
        };

        askQuestion();
      });

    program.parse();
  })();
}
