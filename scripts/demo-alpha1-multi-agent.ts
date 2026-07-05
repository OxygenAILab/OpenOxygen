import { AgentRegistry } from '../src/agents/registry';

async function main() {
  const registry = new AgentRegistry();

  registry.register({
    id: 'planner',
    name: 'Planner Agent',
    capabilities: [{ name: 'planning', score: 10 }],
    execute: async message => ({
      agentId: 'planner',
      success: true,
      output: { plan: [`分析任务：${message.task}`, '生成执行步骤'] },
      score: 0.8,
    }),
  });

  registry.register({
    id: 'executor',
    name: 'Executor Agent',
    capabilities: [{ name: 'execute', score: 10 }],
    execute: async message => ({
      agentId: 'executor',
      success: true,
      output: { executed: message.task, context: message.context },
      score: 0.9,
    }),
  });

  const sequential = await registry.collaborate({
    task: '整理当前项目状态并输出摘要',
    mode: 'sequential',
    requiredCapabilities: ['planning', 'execute'],
  });

  const voting = await registry.collaborate({
    task: '选择最可靠的执行结果',
    mode: 'voting',
    requiredCapabilities: ['planning', 'execute'],
  });

  console.log(JSON.stringify({ agents: registry.list(), sequential, voting }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
