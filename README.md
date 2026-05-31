# OpenOxygen Next

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**OpenOxygen Next** - Vision-first Computer Use Agent with multi-agent orchestration

> OpenOxygen 第一代架构重写，融合 OpenClaw 的多 Agent 通信、UI-TARS 的视觉驱动 GUI 操作、以及 Hermes 的 LLM 编排架构。

## Features

### Vision-First GUI Automation
- **VLM Integration**: GPT-4V, Claude 3, Gemini, Qwen-VL, LLaVA support
- **Visual Element Detection**: No need for brittle selectors
- **Coordinate Prediction**: Precise (x, y) predictions from screenshots
- **Multi-modal Understanding**: Understand UI context naturally

### Multi-Agent Architecture
- **Agent Discovery**: Automatic agent detection and registration
- **Collaborative Execution**: Parallel, sequential, competitive, voting modes
- **Capability Matching**: Route tasks to specialized agents
- **Message Routing**: Broadcast, unicast, multicast messaging

### Natural Language Orchestration
- **Goal-Oriented Planning**: Describe your goal, system plans the steps
- **Dynamic Adaptation**: Adjusts plans based on intermediate results
- **Reflection Loop**: Self-improvement through execution feedback
- **Tool Calling**: Standardized skill invocation

### Multi-Modal Execution
- **GUI Control**: Windows UIA + Vision hybrid approach
- **CLI Execution**: Full shell automation with structured output
- **Browser Automation**: Playwright/CDP integration
- **Custom Skills**: Extensible plugin system

## Quick Start

### Installation

```bash
# Clone the repository
git clone https://github.com/StarsailsClover/OpenOxygen.git
cd OpenOxygen

# Install dependencies
npm install
cargo build --release

# Set up environment
cp .env.example .env
# Edit .env with your API keys
```

### Usage

#### TypeScript/JavaScript

```typescript
import { OpenOxygen } from 'openoxygen-next';

const agent = new OpenOxygen({
  llm: {
    provider: 'openai',
    apiKey: process.env.OPENAI_API_KEY,
    model: 'gpt-4o',
  }
});

// Execute a task
const result = await agent.execute({
  description: 'Open Chrome and search for "AI news"',
  mode: 'gui'
});

console.log(result.summary);
```

#### Python

```python
from openoxygen_next import OpenOxygen

agent = OpenOxygen(
    llm_config={
        "provider": "openai",
        "api_key": "sk-...",
        "model": "gpt-4o"
    }
)

result = await agent.execute(
    "Open Chrome and search for 'AI news'",
    mode="gui"
)

print(result.summary)
```

#### CLI

```bash
# Execute a task
openoxygen execute "Open Chrome and search for AI news" --mode gui

# Interactive mode
openoxygen interactive

# Multi-agent collaboration
openoxygen execute "Analyze this codebase" --collaborate --agents "code,analysis"
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        User Interface                        │
│              (CLI / SDK / WebSocket / REST)                  │
├─────────────────────────────────────────────────────────────┤
│                      Task Orchestrator                      │
│       (Natural Language → Task Graph → Execution)        │
├─────────────────────────────────────────────────────────────┤
│                         LLM Gateway                          │
│       (OpenAI Protocol / Tool Calling / Vision)           │
├─────────────────────────────────────────────────────────────┤
│                        Agent Bridge                          │
│     (Multi-Agent Discovery / Messaging / Coordination)     │
├─────────────────────────────────────────────────────────────┤
│                       Execution Layer                        │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────┐  │
│  │  GUI Ctrl   │ │  CLI Ctrl   │ │   VLM Connector     │  │
│  │(UIA+Vision) │ │(Shell/Term) │ │(GPT-4V/Claude/etc)│  │
│  └─────────────┘ └─────────────┘ └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## Multi-Agent Collaboration

```typescript
// Create specialized agents
const guiAgent = await agent.createAgent({
  type: 'gui_specialist',
  capabilities: ['screenshot', 'click', 'type']
});

const cliAgent = await agent.createAgent({
  type: 'cli_specialist', 
  capabilities: ['execute', 'parse', 'spawn']
});

// Collaborate on a task
const result = await agent.collaborate({
  task: 'Build and deploy this project',
  collaborationType: 'sequential',
  participants: [guiAgent.id, cliAgent.id]
});
```

## Vision-Based GUI Control

```typescript
// VLM-powered element location
const element = await agent.vision.locate({
  screenshot: await agent.gui.screenshot(),
  description: 'The "Submit" button in the form'
});

// Click using visual coordinates
await agent.gui.click(element.x, element.y);

// Or let the VLM predict the next action
const action = await agent.vision.predictAction({
  screenshot: await agent.gui.screenshot(),
  task: 'Complete the login form',
  history: previousActions
});

await agent.executeAction(action);
```

## Skill System

### Built-in Skills

- `gui_click` - Click at coordinates
- `gui_type` - Type text
- `gui_screenshot` - Capture screen
- `gui_wait_for` - Wait for element
- `cli_execute` - Execute shell command
- `cli_spawn` - Start background process
- `file_read` - Read file contents
- `file_write` - Write to file
- `wait` - Pause execution

### Custom Skills

```typescript
import { registerSkill } from 'openoxygen-next';

registerSkill({
  name: 'custom_api_call',
  description: 'Make an API request',
  parameters: [
    { name: 'url', type: 'string', required: true },
    { name: 'method', type: 'string', required: false, default: 'GET' }
  ],
  execute: async (params, context) => {
    const response = await fetch(params.url);
    return { success: true, data: await response.json() };
  }
});
```

## Configuration

### Environment Variables

```bash
# LLM Configuration
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-...
OLLAMA_BASE_URL=http://localhost:11434

# VLM Configuration
VLM_PROVIDER=openai
VLM_MODEL=gpt-4o

# Agent Configuration
ENABLE_MULTI_AGENT=true
AGENT_DISCOVERY_TIMEOUT=5000

# Execution Configuration
MAX_RETRIES=3
DEFAULT_TIMEOUT=30000
ENABLE_REFLECTION=true
```

## Development

### Prerequisites

- Rust 1.75+
- Node.js 18+
- Python 3.10+ (optional)

### Build

```bash
# Build Rust crates
cargo build --release

# Build TypeScript
npm run build

# Build Python bindings (optional)
maturin develop
```

### Test

```bash
# Run Rust tests
cargo test

# Run TypeScript tests
npm test

# Run Python tests
pytest
```

## Project Structure

```
OpenOxygen/
├── crates/                 # Rust core
│   ├── core/             # Runtime engine
│   ├── gui-control/      # GUI automation (UIA + Vision)
│   ├── cli-executor/     # CLI execution
│   ├── perception/       # Computer vision
│   ├── agent-bridge/     # Multi-agent communication
│   └── vlm-connector/    # Vision-language models
├── src/                  # TypeScript business layer
│   ├── orchestrator/     # Task orchestration
│   ├── llm/              # LLM gateway
│   └── skills/           # Skill registry
├── python/               # Python SDK
└── docs/                 # Documentation
```

## Comparison

| Feature | OpenOxygen Next | OpenClaw | UI-TARS | Hermes |
|---------|-----------------|----------|---------|--------|
| Vision GUI | ✅ | ❌ | ✅ | ❌ |
| Multi-Agent | ✅ | ✅ | ❌ | ⚠️ |
| LLM Orchestration | ✅ | ⚠️ | ❌ | ✅ |
| CLI Integration | ✅ | ✅ | ❌ | ✅ |
| Windows Native | ✅ | ✅ | ❌ | ❌ |
| Open Source | ✅ | ✅ | ✅ | ✅ |

## Roadmap

### Phase 1: Core (Completed)
- [x] Task orchestrator framework
- [x] LLM gateway
- [x] Skill registry
- [x] Agent bridge architecture

### Phase 2: Execution (In Progress)
- [ ] Windows UIA integration
- [ ] VLM connector
- [ ] Screen capture optimization
- [ ] CLI executor

### Phase 3: Multi-Agent (Planned)
- [ ] Agent discovery service
- [ ] Message routing
- [ ] Collaboration modes
- [ ] State synchronization

### Phase 4: Perception (Planned)
- [ ] OCR integration
- [ ] Element detection
- [ ] Visual matching
- [ ] VLM fine-tuning interface

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## License

MIT License - see [LICENSE](LICENSE)

## Acknowledgments

- [UI-TARS](https://github.com/bytedance/UI-TARS) - Vision-based GUI automation
- [OpenClaw](https://github.com/...) - Multi-agent framework inspiration
- [Hermes](https://github.com/...) - LLM orchestration patterns

---

**OpenOxygen Next** - Automating the future, visually.
