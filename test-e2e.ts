/**
 * OpenOxygen 端到端测试（CLI模式）
 */

import { LLMGateway } from './src/llm/gateway';
import { TaskOrchestrator } from './src/orchestrator/mod';
import { SkillRegistry, SkillDefinition } from './src/skills/registry';
import { ShortTermMemory } from './src/memory/short-term';
import { PermissionManager } from './src/security/permissions';

async function main() {
  console.log('🚀 OpenOxygen 端到端测试（CLI模式）');
  console.log('='.repeat(60));

  const testModel = 'qwen3:4B';

  // 1. 初始化核心组件
  console.log('\n1. 初始化核心组件...');
  
  const llmGateway = new LLMGateway({
    provider: 'ollama',
    apiKey: '',
    model: testModel,
    baseUrl: 'http://localhost:11434',
    temperature: 0.7,
  });

  const skillRegistry = new SkillRegistry();
  const memory = new ShortTermMemory();
  const permissionManager = new PermissionManager();

  const testSkills: SkillDefinition[] = [
    {
      id: 'math_calculator',
      name: '数学计算器',
      description: '执行数学计算',
      category: 'custom',
      parameters: [
        { name: 'expression', type: 'string', required: true, description: '数学表达式' },
      ],
      returns: { type: 'string', description: '计算结果' },
      handler: async (...args: unknown[]) => {
        const expression = args[0] as string;
        try {
          const result = new Function(`return ${expression}`)();
          return { success: true, result: `${expression} = ${result}` };
        } catch {
          return { success: false, error: 'Invalid expression' };
        }
      },
      enabled: true,
      version: '1.0.0',
    },
    {
      id: 'system_info',
      name: '系统信息',
      description: '获取系统信息',
      category: 'system',
      parameters: [],
      returns: { type: 'object', description: '系统信息对象' },
      handler: async () => {
        return {
          success: true,
          result: JSON.stringify({
            platform: process.platform,
            nodeVersion: process.version,
            memoryUsage: process.memoryUsage(),
          }, null, 2),
        };
      },
      enabled: true,
      version: '1.0.0',
    },
    {
      id: 'web_search',
      name: '网页搜索',
      description: '搜索网页内容（模拟）',
      category: 'custom',
      parameters: [
        { name: 'query', type: 'string', required: true, description: '搜索关键词' },
      ],
      returns: { type: 'string', description: '搜索结果摘要' },
      handler: async (...args: unknown[]) => {
        const query = args[0] as string;
        return {
          success: true,
          result: `模拟搜索结果: "${query}" 的搜索结果摘要...\n\n1. OpenOxygen 官方文档\n2. GitHub 仓库\n3. 技术博客文章\n4. 相关讨论`,
        };
      },
      enabled: true,
      version: '1.0.0',
    },
  ];

  testSkills.forEach(skill => skillRegistry.register(skill));
  console.log(`   ✅ 已注册 ${testSkills.length} 个测试技能`);

  // 2. 创建任务编排器
  console.log('\n2. 创建任务编排器...');
  const orchestrator = new TaskOrchestrator({
    llmGateway,
    maxRetries: 2,
    enableReflection: true,
  });
  console.log('   ✅ 任务编排器创建成功');

  // 3. 测试简单任务
  console.log('\n3. 测试简单任务...');
  const simpleTask = {
    description: '计算 25 的平方',
    mode: 'auto' as const,
    priority: 'normal' as const,
  };

  try {
    const simpleResult = await orchestrator.execute(simpleTask);
    console.log(`   ✅ 任务: ${simpleTask.description}`);
    console.log(`   状态: ${simpleResult.status}`);
    if (simpleResult.summary) {
      console.log(`   摘要: ${simpleResult.summary}`);
    }
  } catch (error) {
    console.error(`   ❌ 任务失败: ${error instanceof Error ? error.message : error}`);
  }

  // 4. 测试复杂任务
  console.log('\n4. 测试复杂任务...');
  const complexTask = {
    description: '告诉我当前的系统信息，然后搜索 OpenOxygen 的相关信息',
    mode: 'auto' as const,
    priority: 'high' as const,
  };

  try {
    const complexResult = await orchestrator.execute(complexTask);
    console.log(`   ✅ 任务: ${complexTask.description}`);
    console.log(`   状态: ${complexResult.status}`);
    console.log(`   步骤数: ${complexResult.results.length}`);
    
    complexResult.results.forEach((step, index) => {
      console.log(`   步骤 ${index + 1}: ${step.type} - ${step.success ? '成功' : '失败'}`);
    });
    
    if (complexResult.summary) {
      console.log(`   摘要: ${complexResult.summary}`);
    }
  } catch (error) {
    console.error(`   ❌ 任务失败: ${error instanceof Error ? error.message : error}`);
  }

  // 5. 测试记忆功能
  console.log('\n5. 测试记忆功能...');
  
  await memory.set('user_preference', {
    theme: 'dark',
    timestamp: Date.now(),
  });
  
  await memory.set('session_context', {
    lastTask: '系统信息查询',
    timestamp: Date.now(),
  });

  const theme = await memory.get('user_preference');
  const lastTask = await memory.get('session_context');
  
  console.log(`   ✅ 读取用户偏好: ${JSON.stringify(theme)}`);
  console.log(`   ✅ 读取会话上下文: ${JSON.stringify(lastTask)}`);

  await memory.delete('session_context');
  console.log(`   ✅ 删除会话上下文完成`);

  // 6. 测试权限管理
  console.log('\n6. 测试权限管理...');
  
  const hasExecutePermission = permissionManager.checkPermission('shell.execute');
  console.log(`   ✅ shell.execute 权限检查: ${hasExecutePermission.allowed}`);
  
  const fileReadPermission = permissionManager.checkPermission('file.read');
  console.log(`   ✅ file.read 权限检查: ${fileReadPermission.allowed}`);

  // 7. 测试流式执行
  console.log('\n7. 测试流式执行...');
  console.log(`   任务: "解释什么是计算机使用智能体"`);
  
  try {
    let stepCount = 0;
    for await (const step of orchestrator.executeStream({
      description: '解释什么是计算机使用智能体',
      mode: 'auto' as const,
    })) {
      stepCount++;
      console.log(`   [步骤 ${stepCount}] ${step.success ? '✅' : '❌'} ${step.type}`);
      if (step.output?.message) {
        console.log(`      ${step.output.message.substring(0, 100)}...`);
      }
    }
    console.log(`   ✅ 流式执行完成，共 ${stepCount} 个步骤`);
  } catch (error) {
    console.error(`   ❌ 流式执行失败: ${error instanceof Error ? error.message : error}`);
  }

  // 8. 测试技能执行
  console.log('\n8. 测试技能执行...');
  
  const mathResult = await skillRegistry.execute('math_calculator', ['10 + 20 * 2']);
  console.log(`   ✅ 数学计算 "10 + 20 * 2": ${mathResult.success ? mathResult.result : mathResult.error}`);
  
  const systemResult = await skillRegistry.execute('system_info', []);
  console.log(`   ✅ 系统信息: ${systemResult.success ? '获取成功' : '失败'}`);

  // 9. 获取统计信息
  console.log('\n9. 获取系统统计...');
  const llmStats = llmGateway.getStats();
  console.log(`   ✅ LLM 请求数: ${llmStats.requests}`);
  console.log(`   ✅ LLM 错误数: ${llmStats.errors}`);
  console.log(`   ✅ LLM 成功率: ${((llmStats.requests - llmStats.errors) / llmStats.requests * 100).toFixed(1)}%`);
  
  console.log(`   ✅ 已注册技能数: ${skillRegistry.count()}`);

  // 10. 清理资源
  console.log('\n10. 清理资源...');
  await orchestrator.dispose();
  await memory.clear();
  console.log('   ✅ 资源清理完成');

  console.log('\n'.repeat(2));
  console.log('🎉 端到端测试完成！');
  console.log('='.repeat(60));
}

main();
