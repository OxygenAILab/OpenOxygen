/**
 * OpenOxygen Ollama 集成测试脚本（简化版）
 * 
 * 测试自然语言交互和任务执行功能
 */

import { LLMGateway } from '../src/llm/gateway';
import { OllamaManager } from '../src/ollama/manager';

async function main() {
  console.log('🚀 OpenOxygen Ollama 集成测试');
  console.log('='.repeat(60));

  // 1. 检查 Ollama 服务状态
  console.log('\n1. 检查 Ollama 服务状态...');
  const ollamaManager = new OllamaManager();
  
  try {
    const models = await ollamaManager.listModels();
    console.log(`   ✅ Ollama 服务正常，已加载 ${models.length} 个模型:`);
    models.forEach(m => {
      console.log(`      - ${m.name} (${m.parameterSize}, ${m.family})`);
    });

    // 2. 选择测试模型（使用最小的可用模型）
    const testModel = 'llama3.2:1b';
    console.log(`\n2. 使用模型: ${testModel}`);

    // 3. 测试 OllamaManager.generate
    console.log('\n3. 测试 OllamaManager.generate...');
    const generateResult = await ollamaManager.generate(
      testModel,
      '你好，介绍一下你自己'
    );
    console.log(`   ✅ 生成成功:`);
    console.log(`   ${generateResult.response}`);

    // 4. 测试 LLMGateway（核心推理网关）
    console.log('\n4. 测试 LLMGateway...');
    const llmGateway = new LLMGateway({
      provider: 'ollama',
      apiKey: '',
      model: testModel,
      baseUrl: 'http://localhost:11434',
      temperature: 0.7,
    });

    // 4.1 简单问答测试
    console.log('\n   4.1 简单问答测试...');
    const response1 = await llmGateway.complete({
      prompt: '计算 25 的平方',
    });
    console.log(`   ✅ 问题: 计算 25 的平方`);
    console.log(`   📝 回答: ${response1.content}`);
    console.log(`   📊 使用: ${response1.usage.totalTokens} tokens`);

    // 4.2 多轮对话测试
    console.log('\n   4.2 多轮对话测试...');
    const response2 = await llmGateway.complete({
      prompt: '',
      system: '你是一个专业的技术顾问',
      messages: [
        { role: 'user', content: '什么是人工智能？' },
        { role: 'assistant', content: '人工智能是计算机科学的一个分支...' },
        { role: 'user', content: '请用更简单的语言解释' },
      ],
    });
    console.log(`   ✅ 问题: 请用更简单的语言解释`);
    console.log(`   📝 回答: ${response2.content}`);

    // 4.3 流式响应测试
    console.log('\n   4.3 流式响应测试...');
    console.log(`   问题: 简单介绍一下计算机使用智能体\n   回答:`);
    const streamResponse: string[] = [];
    for await (const chunk of llmGateway.stream({
      prompt: '简单介绍一下计算机使用智能体',
    })) {
      streamResponse.push(chunk);
      process.stdout.write(chunk);
    }
    console.log('\n');

    // 5. 测试视觉模型
    const visionModel = models.find(m => m.capabilities.includes('vision'));
    if (visionModel) {
      console.log(`\n5. 测试视觉模型: ${visionModel.name}`);
      console.log(`   (视觉测试需要图片输入，跳过详细测试)`);
    }

    // 6. 获取统计信息
    console.log('\n6. 获取 LLM 统计信息...');
    const stats = llmGateway.getStats();
    console.log(`   ✅ 请求数: ${stats.requests}`);
    console.log(`   ✅ 错误数: ${stats.errors}`);
    console.log(`   ✅ 成功率: ${((stats.requests - stats.errors) / stats.requests * 100).toFixed(1)}%`);

  } catch (error) {
    console.error('\n❌ 测试失败:', error instanceof Error ? error.message : error);
    console.error('详细错误:', error);
    process.exit(1);
  }

  console.log('\n'.repeat(2));
  console.log('🎉 所有测试完成！');
  console.log('='.repeat(60));
}

main();
