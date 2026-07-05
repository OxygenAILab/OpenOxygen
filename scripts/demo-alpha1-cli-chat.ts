import { OpenOxygen, LLMConfig } from '../src';

async function main() {
  const llm: LLMConfig = {
    provider: (process.env.OPENOXYGEN_PROVIDER || 'ollama') as LLMConfig['provider'],
    model: process.env.OPENOXYGEN_MODEL || 'aikid123/qwen3-coder:latest',
    baseURL: process.env.OPENOXYGEN_BASE_URL || 'http://localhost:11434',
    apiKey: process.env.OPENOXYGEN_API_KEY,
  };

  const agent = new OpenOxygen({ llm });
  try {
    const answer = await agent.chat('用一句话说明 OpenOxygen v26 alpha 能做什么。');
    console.log(answer);
  } finally {
    await agent.dispose();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
