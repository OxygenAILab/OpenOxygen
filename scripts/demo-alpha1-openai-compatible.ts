import { OpenOxygen } from '../src';

async function main() {
  const agent = new OpenOxygen({
    llm: {
      provider: 'openai',
      apiKey: process.env.STEPPLAN_API_KEY || process.env.OPENOXYGEN_API_KEY || '',
      baseURL: process.env.STEPPLAN_BASE_URL || 'https://api.stepfun.com/step_plan/v1',
      model: process.env.STEPPLAN_MODEL || 'step-3.7-flash',
    },
  });

  try {
    const answer = await agent.chat('回复 JSON：{"ok":true,"demo":"openai-compatible"}');
    console.log(answer);
  } finally {
    await agent.dispose();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
