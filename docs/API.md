# OpenOxygen 2.0 API Documentation

## OpenOxygen Class

Main entry point for the framework.

### Constructor

```typescript
new OpenOxygen(config: OpenOxygenConfig)
```

### Configuration

```typescript
interface OpenOxygenConfig {
  llm: LLMConfig;
  workingDirectory?: string;
  enableGui?: boolean;
  enableCli?: boolean;
  maxRetries?: number;
  enableReflection?: boolean;
}

interface LLMConfig {
  provider: 'openai' | 'anthropic' | 'local';
  apiKey: string;
  baseUrl?: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
}
```

### Methods

#### execute(request: TaskRequest): Promise<TaskResponse>

Execute a natural language task.

```typescript
interface TaskRequest {
  description: string;      // Natural language task description
  context?: string;         // Additional context
  constraints?: string[];   // Task constraints
  priority?: 'critical' | 'high' | 'normal' | 'low';
  mode?: 'auto' | 'gui' | 'cli';
}

interface TaskResponse {
  taskId: string;
  plan: TaskPlan;
  status: 'pending' | 'running' | 'completed' | 'failed';
  results: StepResult[];
  summary?: string;
}
```

Example:
```typescript
const agent = new OpenOxygen({
  llm: {
    provider: 'openai',
    apiKey: process.env.OPENAI_API_KEY,
    model: 'gpt-4o'
  }
});

const result = await agent.execute({
  description: 'Open Chrome and search for "OpenAI"',
  mode: 'gui'
});
```

#### executeStream(request: TaskRequest): AsyncGenerator<StepResult>

Stream execution progress in real-time.

```typescript
for await (const step of agent.executeStream({
  description: 'Run npm install'
})) {
  console.log(`Step ${step.stepId}: ${step.success ? '✓' : '✗'}`);
}
```

#### registerSkill(skill: Skill): void

Register a custom skill.

```typescript
agent.registerSkill({
  name: 'custom_action',
  description: 'Custom automation action',
  version: '1.0.0',
  category: 'custom',
  parameters: [
    { name: 'param1', type: 'string', required: true, description: 'First parameter' }
  ],
  returns: { type: 'object', description: 'Result' },
  examples: [],
  execute: async (params, context) => {
    // Implementation
    return { success: true, data: {} };
  }
});
```

#### dispose(): Promise<void>

Clean up resources.

```typescript
await agent.dispose();
```

## LLM Gateway

Direct LLM access for custom implementations.

### complete(request: CompletionRequest): Promise<CompletionResponse>

Get text completion from LLM.

```typescript
const response = await llm.complete({
  system: 'You are a helpful assistant',
  prompt: 'What is the weather?',
  format: 'json'
});
```

### vision(request: VisionRequest): Promise<CompletionResponse>

Vision-based question answering.

```typescript
const response = await llm.vision({
  prompt: 'What buttons are visible?',
  images: [screenshotBase64]
});
```

## Skill Registry

Manage available automation skills.

### getAll(): string[]

Get all registered skill names.

```typescript
const skills = registry.getAll();
// ['gui_click', 'gui_type', 'cli_execute', ...]
```

### get(name: string): Skill | undefined

Get skill by name.

### search(query: string): Skill[]

Search skills by keyword.

```typescript
const guiSkills = registry.search('gui');
```

### execute(name: string, params: any, context: SkillContext): Promise<SkillResult>

Execute a skill.

```typescript
const result = await registry.execute('gui_click', {
  x: 100,
  y: 200
}, context);
```

## Built-in Skills

### GUI Skills

#### gui_click
Click at specified coordinates.

Parameters:
- `x` (number, required): X coordinate
- `y` (number, required): Y coordinate
- `button` (string, optional): 'left' | 'right' | 'middle', default 'left'

#### gui_type
Type text.

Parameters:
- `text` (string, required): Text to type
- `interval` (number, optional): Keystroke interval in ms, default 10

#### gui_screenshot
Capture screenshot.

Parameters:
- `region` (object, optional): { x, y, width, height }
- `format` (string, optional): 'png' | 'jpeg', default 'png'

#### gui_wait_for
Wait for element to appear.

Parameters:
- `target` (any, required): Element to wait for
- `timeout` (number, optional): Timeout in ms, default 30000

### CLI Skills

#### cli_execute
Execute shell command.

Parameters:
- `command` (string, required): Command to execute
- `cwd` (string, optional): Working directory
- `env` (object, optional): Environment variables
- `timeout` (number, optional): Timeout in ms, default 60000

### File Skills

#### file_read
Read file contents.

Parameters:
- `path` (string, required): File path
- `encoding` (string, optional): 'utf-8' | 'ascii' | 'base64'

#### file_write
Write to file.

Parameters:
- `path` (string, required): File path
- `content` (string, required): Content to write
- `append` (boolean, optional): Append mode, default false

### System Skills

#### wait
Wait for duration.

Parameters:
- `durationMs` (number, required): Duration in milliseconds

#### getSystemInfo
Get system information.

No parameters required.

## Error Handling

All methods may throw errors:

```typescript
try {
  await agent.execute({ description: 'Task' });
} catch (error) {
  if (error instanceof TaskExecutionError) {
    // Handle execution error
  }
}
```

## Types

### StepResult

```typescript
interface StepResult {
  stepId: string;
  type: string;
  success: boolean;
  output: any;
  screenshot?: string; // base64
  durationMs: number;
  error?: string;
}
```

### SkillContext

```typescript
interface SkillContext {
  sessionId: string;
  workingDirectory: string;
  guiController?: any;
  cliExecutor?: any;
  memory: Map<string, any>;
  getScreenshot: () => Promise<string>;
  sendMessage: (type: string, data: any) => void;
}
```

## CLI Usage

```bash
# Execute a task
openoxygen execute "Open Chrome and search for AI news" --mode gui

# Interactive mode
openoxygen interactive

# With options
openoxygen execute "npm install" --mode cli --priority high
```

## WebSocket API

For real-time communication:

```typescript
// Connect
const ws = new WebSocket('ws://localhost:8080');

// Send task
ws.send(JSON.stringify({
  type: 'execute',
  payload: {
    description: 'Task description',
    mode: 'gui'
  }
}));

// Receive updates
ws.onmessage = (event) => {
  const update = JSON.parse(event.data);
  console.log(update.stepId, update.status);
};
```
