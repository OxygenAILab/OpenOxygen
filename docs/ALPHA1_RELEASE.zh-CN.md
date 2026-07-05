# OpenOxygen v26.0-alpha.1

## 安装

```bash
npm install
npm run build
```

本地开发可直接使用：

```bash
npx ts-node src/index.ts agents
```

构建后通过 Node.js 使用 CLI：

```bash
npm run build
node dist/index.js agents
```

## LLM 配置

### Ollama

```bash
node dist/index.js chat "介绍 OpenOxygen" --provider ollama --model aikid123/qwen3-coder:latest --url http://localhost:11434
```

PowerShell 环境变量：

```bash
$env:OPENOXYGEN_PROVIDER="ollama"
$env:OPENOXYGEN_MODEL="aikid123/qwen3-coder:latest"
$env:OPENOXYGEN_BASE_URL="http://localhost:11434"
```

### OpenAI API 兼容服务，包括 StepPlan

```bash
node dist/index.js chat "你好" --method OpenAIAPI --model step-3.7-flash --url https://api.stepfun.com/step_plan/v1 --key <你的-key>
```

配置格式：

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
node dist/index.js chat "你好" --provider anthropic --model claude-3-5-sonnet-latest --key <你的-key>
```

## CLI 命令

### 与 LLM 对话

```bash
node dist/index.js chat "解释这个项目"
```

### 让 LLM 通过 OpenOxygen 执行任务

```bash
node dist/index.js execute "打开记事本并输入 Hello" --mode auto
```

### 交互模式

```bash
node dist/index.js interactive
node dist/index.js interactive --execute
```

### 多 Agent 协作

```bash
node dist/index.js agents
node dist/index.js collaborate "分析当前项目并输出摘要" --mode sequential --capabilities planning,execute
node dist/index.js collaborate "给出三个方案并投票" --mode voting --capabilities chat,reasoning
```

## Demo 场景

```bash
npx ts-node scripts/demo-alpha1-multi-agent.ts
npx ts-node scripts/demo-alpha1-cli-chat.ts
npx ts-node scripts/demo-alpha1-openai-compatible.ts
```

`demo-alpha1-cli-chat.ts` 需要本地 Ollama。`demo-alpha1-openai-compatible.ts` 需要有效的 OpenAI 兼容 API key。

## 发布检查

```bash
npx tsc --noEmit
npm run build
```

提交后打发布标签：

```bash
git tag v26.0-alpha.1
git push origin v26.0-alpha.1
```
