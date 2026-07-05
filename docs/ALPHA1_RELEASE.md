# OpenOxygen v26.0-alpha.1

## Installation

```bash
npm install
npm run build
```

For local development:

```bash
npx ts-node src/index.ts agents
```

After building, use the CLI with Node.js:

```bash
npm run build
node dist/index.js agents
```

## LLM Configuration

### Ollama

```bash
node dist/index.js chat "Introduce OpenOxygen" --provider ollama --model aikid123/qwen3-coder:latest --url http://localhost:11434
```

PowerShell environment variables:

```bash
$env:OPENOXYGEN_PROVIDER="ollama"
$env:OPENOXYGEN_MODEL="aikid123/qwen3-coder:latest"
$env:OPENOXYGEN_BASE_URL="http://localhost:11434"
```

### OpenAI-compatible APIs, including StepPlan

```bash
node dist/index.js chat "Hello" --method OpenAIAPI --model step-3.7-flash --url https://api.stepfun.com/step_plan/v1 --key <your-key>
```

Configuration shape:

```json
{
  "tokenname": "StepPlan",
  "_type": "stepfun",
  "key": "<redacted>",
  "models": "step-3.7-flash",
  "url": "https://api.stepfun.com/step_plan/v1",
  "method": "OpenAIAPI"
}
```

### Anthropic

```bash
node dist/index.js chat "Hello" --provider anthropic --model claude-3-5-sonnet-latest --key <your-key>
```

## CLI Commands

### Chat with an LLM

```bash
node dist/index.js chat "Explain this project"
```

### Let the LLM execute tasks through OpenOxygen

```bash
node dist/index.js execute "Open Notepad and type Hello" --mode auto
```

### Interactive mode

```bash
node dist/index.js interactive
node dist/index.js interactive --execute
```

### Multi-agent collaboration

```bash
node dist/index.js agents
node dist/index.js collaborate "Analyze this project and summarize it" --mode sequential --capabilities planning,execute
node dist/index.js collaborate "Propose three options and vote" --mode voting --capabilities chat,reasoning
```

## Demo Scenarios

```bash
npx ts-node scripts/demo-alpha1-multi-agent.ts
npx ts-node scripts/demo-alpha1-cli-chat.ts
npx ts-node scripts/demo-alpha1-openai-compatible.ts
```

`demo-alpha1-cli-chat.ts` requires local Ollama. `demo-alpha1-openai-compatible.ts` requires a valid OpenAI-compatible API key.

## Release Checks

```bash
npx tsc --noEmit
npm run build
```

Release tag after committing:

```bash
git tag v26.0-alpha.1
git push origin v26.0-alpha.1
```
