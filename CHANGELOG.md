# Changelog

All notable changes to OpenOxygen Next will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.26.149] - 2026-05-30

### Phase 2 Complete - Core Implementation

#### Added
- **Windows UIA Integration**: Full Windows UI Automation support
  - Element discovery and interaction
  - Mouse and keyboard simulation
  - Screen capture with BitBlt
  - Control type recognition
  
- **OCR Engine**: Tesseract integration with preprocessing
  - Grayscale, contrast enhancement, denoising
  - Multiple language support
  - Confidence threshold filtering
  - Common error correction

- **VLM Support**: GPT-4V API integration
  - Base64 image encoding
  - Streaming responses (SSE)
  - Multi-modal message handling
  - JSON mode responses

- **Persistence Layer**: SQLite and vector storage
  - Hierarchical memory (short/medium/long term)
  - Full-text search with FTS5
  - Vector similarity search
  - Automatic save and WAL mode

- **HTN Planner**: Task planning and execution
  - Hierarchical task decomposition
  - Method selection with preconditions
  - DAG construction for task ordering
  - Replanning on failure

- **Execution Engine**: Atomic operation execution
  - GUI controller trait
  - CLI executor trait
  - Browser controller trait
  - Skill registry integration

- **Browser Automation**: Playwright CDP integration
  - Navigation and element interaction
  - Screenshot and page source extraction
  - JavaScript evaluation
  - Multi-page management

- **Built-in Skills**: 20+ automation skills
  - GUI: click, type, screenshot, wait_for
  - CLI: execute, spawn, kill
  - Browser: navigate, click, type
  - System: wait, memory_store, memory_retrieve

### Architecture
- Multi-language architecture (Rust + TypeScript + Python)
- Vision-first GUI automation (inspired by UI-TARS)
- Multi-agent communication (inspired by OpenClaw)
- LLM orchestration (inspired by Hermes)

### Security
- Zero-trust permission model (framework)
- Prompt injection detection (reserved)
- Audit logging capability

### Performance
- Async/await throughout
- Concurrent task execution
- Vector similarity search optimization
- SQLite WAL mode

## [1.0.0] - 2026-01-15

### Phase 1 - Architecture Foundation

#### Added
- Core runtime framework
- Task orchestration engine
- LLM gateway with multi-provider support
- Skill registry framework
- Agent bridge architecture
- Project structure and build system

---

## Roadmap

### [1.27.0] - Phase 3 (Planned)
- End-to-end integration testing
- Performance benchmarking
- Linux and macOS support
- Advanced reflection mechanisms
- Distributed multi-agent execution

### [1.28.0] - Phase 4 (Planned)
- GPU acceleration
- Advanced OCR (Windows native, PaddleOCR)
- Additional VLM providers (Claude, Gemini, Qwen)
- Vector database integration (Qdrant)
- Plugin system

### [2.0.0] - Stable Release (Planned)
- Production stability
- Complete documentation
- Community plugins
- Web management interface
- Mobile support

---

## Version Numbering

- **Major**: Breaking changes
- **Minor**: New features and improvements
- **Patch**: Bug fixes and small improvements
- **Suffix**: Pre-release versions
  - `-next`: Development version
  - `-beta`: Beta testing
  - `-rc`: Release candidate

## Internal Version

Format: `(XYZ)` where:
- X: Major phase (1=Foundation, 2=Core, 3=Integration, 4=Stable)
- YZ: Build number within phase

Current: `(1149)` = Phase 1, Build 149
