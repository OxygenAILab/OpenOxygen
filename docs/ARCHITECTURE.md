# OpenOxygen 2.0 Architecture

## Overview

OpenOxygen 2.0 is a next-generation Computer Use Agent framework that enables LLMs to control computers through natural language. It combines vision-based GUI automation, command-line execution, and intelligent task orchestration.

## Core Principles

1. **Vision-First GUI Control**: Like UI-TARS, we use visual understanding to locate and interact with UI elements
2. **Natural Language Orchestration**: Users describe goals, the system autonomously plans and executes
3. **Dual-Mode Operation**: Seamless switching between CLI and GUI automation
4. **Extensible Skill System**: Plugin architecture for custom automation capabilities
5. **Security by Design**: Zero-trust permission model with audit logging

## Architecture Layers

```
┌─────────────────────────────────────────────────────────────┐
│                    User Interface Layer                      │
│              (CLI / API / WebSocket / SDK)                  │
├─────────────────────────────────────────────────────────────┤
│                   Task Orchestrator                         │
│         (Natural Language → Task Graph → Execution)        │
├─────────────────────────────────────────────────────────────┤
│                      LLM Gateway                             │
│      (Multi-model Support / Tool Calling / Vision)        │
├─────────────────────────────────────────────────────────────┤
│                   Execution Layer                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │   GUI Ctrl  │  │   CLI Ctrl  │  │   Browser Ctrl      │ │
│  │(Vision-based│  │(Shell/Term  │  │(CDP/Playwright)     │ │
│  └─────────────┘  └─────────────┘  └─────────────────────┘ │
├─────────────────────────────────────────────────────────────┤
│                   Perception Layer                           │
│    (Screen Capture / OCR / Element Detection / CV)          │
├─────────────────────────────────────────────────────────────┤
│                   Skill System                               │
│    (Built-in Skills / Custom Skills / Skill Registry)       │
├─────────────────────────────────────────────────────────────┤
│                   State Management                           │
│    (Session Context / Memory / Vector Store)                │
└─────────────────────────────────────────────────────────────┘
```

## Component Details

### 1. Task Orchestrator

The orchestrator is the brain of the system, responsible for:
- **Task Analysis**: Understanding user intent using LLM
- **Plan Generation**: Creating executable step-by-step plans
- **Execution Management**: Coordinating step execution with retry logic
- **Adaptive Planning**: Adjusting plans based on intermediate results

Key files:
- `src/orchestrator/planner.ts` - Task planning logic
- `src/orchestrator/executor.ts` - Plan execution engine
- `src/orchestrator/context.ts` - Session state management

### 2. LLM Gateway

Unified interface for multiple LLM providers:
- **Providers**: OpenAI, Anthropic, Local (Ollama, LM Studio)
- **Features**: Tool calling, vision understanding, streaming
- **Protocol**: OpenAI-compatible API

Key files:
- `src/llm/gateway.ts` - Main gateway implementation

### 3. Execution Layer

#### GUI Controller (`crates/gui-control/`)
Rust-based high-performance GUI automation:
- Windows UIA (UI Automation) integration
- Visual element detection and matching
- Mouse/keyboard simulation
- Screenshot capture and analysis

Key modules:
- `capture.rs` - Screen capture
- `input.rs` - Input simulation
- `uia.rs` - Windows UIA integration
- `vision.rs` - Computer vision utilities

#### CLI Executor (`crates/cli-executor/`)
Command-line execution with structured output:
- Shell command execution
- Output parsing (JSON, YAML, CSV)
- Process management
- Working directory handling

Key modules:
- `lib.rs` - Main executor
- `parser.rs` - Output parsing
- `shell.rs` - Shell integration

### 4. Perception Layer

Computer vision and understanding:
- **OCR**: Text recognition from screenshots
- **Element Detection**: UI element identification
- **Visual Matching**: Template matching for icons/buttons
- **Scene Understanding**: LLM-based visual description

Key files:
- `crates/perception/src/lib.rs` - Main perception engine

### 5. Skill System

Extensible automation capabilities:
- **System Skills**: wait, getSystemInfo
- **GUI Skills**: click, type, scroll, screenshot
- **CLI Skills**: execute, spawn, kill
- **File Skills**: read, write, list
- **Custom Skills**: User-defined automation

Key files:
- `src/skills/registry.ts` - Skill registration and management

## Data Flow

```
User Input
    ↓
[Task Analysis] → LLM
    ↓
[Plan Generation] → Task Graph
    ↓
[Step Execution] → GUI/CLI/Browser
    ↓
[Result Validation] → Screenshot/Output
    ↓
[Adaptive Planning] → Adjust if needed
    ↓
[Task Completion]
```

## Key Design Decisions

### Rust + TypeScript Architecture
- **Rust**: Performance-critical components (GUI control, screen capture)
- **TypeScript**: Business logic, LLM integration, API layer

### Vision-Based GUI Control
Unlike traditional automation frameworks that rely on element IDs or selectors:
- Locate elements by visual appearance
- More resilient to UI changes
- Works with any application
- Inspired by UI-TARS and OSWorld

### Natural Language Orchestration
Instead of scripted automation:
- Users describe goals in natural language
- LLM breaks down into executable steps
- System adapts to real-time feedback

### Tool Calling Protocol
Standardized skill invocation:
- OpenAI-compatible tool schema
- Automatic parameter validation
- Structured error handling

## Performance Considerations

1. **Screenshot Optimization**: 
   - Selective region capture
   - Compression for LLM transmission
   - Caching for repeated operations

2. **LLM Usage**:
   - Streaming for responsiveness
   - Caching for common operations
   - Vision model for complex scenes

3. **Execution**:
   - Parallel step execution when safe
   - Retry with exponential backoff
   - Timeout handling

## Security Model

1. **Permission System**: Each skill requires explicit permission
2. **Audit Logging**: All actions logged with screenshots
3. **Sandbox**: Untrusted skills run in isolated environment
4. **User Confirmation**: Critical operations require confirmation

## Future Extensions

1. **Multi-Agent**: Coordinate multiple agents
2. **Learning**: Remember successful patterns
3. **Mobile**: iOS/Android automation
4. **Cloud**: Distributed execution

## References

- UI-TARS: ByteDance's vision-based GUI agent
- OSWorld: Open-ended computer task benchmark
- OpenClaw: Multi-agent framework
- Hermes: Autonomous agent framework
