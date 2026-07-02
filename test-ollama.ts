/**
 * OpenOxygen Ollama 集成测试脚本
 * 
 * 测试自然语言交互和任务执行功能
 */

import { OpenOxygen, OpenOxygenConfig } from './src';
import { OllamaManager } from './src/ollama/manager';

async function main() {
  console.log('🚀 OpenOxygen Ollama 集成测试');
  console.log('='.repeat(60));

  // 初始化 Ollama 管理器
  const ollamaManager = new OllamaManager();
  
  try {
    // 1. 检查 Ollama 服务状态
    console.log('\n1. 检查 Ollama 服务状态...');
    const models = await ollamaManager.listModels();
    console.log(`   ✅ Ollama 服务正常，已加载 ${models.length} 个模型:`);
    models.forEach(m => {
      console.log(`      - ${m.name} (${m.parameterSize}, ${m.family})`);
    });

    // 2. 选择测试模型
    const testModel = 'qwen3:4B';
    console.log(`\n2. 使用模型: ${testModel}`);

    // 3. 创建 OpenOxygen 实例
    console.log('\n3. 初始化 OpenOxygen...');
    const config: OpenOxygenConfig = {
      llm: {
        provider: 'ollama',
        apiKey: '',
        model: testModel,
        baseUrl: 'http://localhost:11434',
      },
      maxRetries: 3,
      enableReflection: true,
    };

    const agent = new OpenOxygen(config);
    console.log('   ✅ OpenOxygen 初始化成功');

    // 4. 测试自然语言交互
    console.log('\n4. 自然语言交互测试...');
    const testTasks = [
      '你好，介绍一下你自己',
      '计算 25 的平方',
      '解释什么是人工智能',
      '用中文写一首关于春天的诗',
    ];

    for (let i = 0; i < testTasks.length; i++) {
      const task = testTasks[i];
      console.log(`\n   任务 ${i + 1}: "${task}"`);
      
      try {
        const result = await agent.execute({
          description: task,
          mode: 'auto',
          priority: 'normal',
        });
        
        console.log(`   状态: ${result.status}`);
        if (result.summary) {
          console.log(`   摘要: ${result.summary}`);
        }
      } catch (error) {
        console.error(`   ❌ 执行失败: ${error instanceof Error ? error.message : error}`);
      }
    }

    // 5. 测试任务执行流程
    console.log('\n5. 任务执行流程测试...');
    const complexTask = '打开浏览器，搜索 "OpenOxygen"，然后告诉我搜索结果';
    console.log(`   任务: "${complexTask}"`);
    
    try {
      const result = await agent.execute({
        description: complexTask,
        mode: 'auto',
        priority: 'high',
      });
      
      console.log(`   状态: ${result.status}`);
      console.log(`   步骤数: ${result.results.length}`);
      
      result.results.forEach((step, index) => {
        console.log(`   步骤 ${index + 1}: ${step.type} - ${step.success ? '成功' : '失败'}`);
      });
      
      if (result.summary) {
        console.log(`   摘要: ${result.summary}`);
      }
    } catch (error) {
      console.error(`   ❌ 执行失败: ${error instanceof Error ? error.message : error}`);
    }

    // 6. 测试流式执行
    console.log('\n6. 流式执行测试...');
    console.log('   任务: "简单介绍一下计算机使用智能体"');
    
    try {
      for await (const step of agent.executeStream({
        description: '简单介绍一下计算机使用智能体',
        mode: 'auto',
      })) {
        console.log(`   [${step.type}] ${step.success ? '✅' : '❌'} ${step.output?.message || step.output?.content || ''}`);
      }
    } catch (error) {
      console.error(`   ❌ 流式执行失败: ${error instanceof Error ? error.message : error}`);
    }

    // 7. 测试技能注册
    console.log('\n7. 技能注册测试...');
    const skillCount = agent.getSkills().length;
    console.log(`   当前已注册技能: ${skillCount} 个`);

    // 8. 清理资源
    console.log('\n8. 清理资源...');
    await agent.dispose();
    console.log('   ✅ 资源清理完成');

  } catch (error) {
    console.error('\n❌ 测试失败:', error instanceof Error ? error.message : error);
    process.exit(1);
  }

  console.log('\n'.repeat(2));
  console.log('🎉 所有测试完成！');
  console.log('='.repeat(60));
}

main();
