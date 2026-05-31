# OpenOxygen Next 重写计划

## 项目命名

**OpenOxygen Next** - 第一代架构重写版本

## 远程仓库

- **主仓库**: https://github.com/StarsailsClover/OpenOxygen.git
- **清理策略**: 保留本地文档、协议文件，删除源码/测试/构建文件

## 技术栈

### 多语言架构

| 语言 | 用途 | 核心模块 |
|------|------|----------|
| **Rust** | 性能关键组件 | GUI控制、CLI执行、屏幕捕获、VLM连接、Agent桥接 |
| **TypeScript** | 业务逻辑层 | LLM网关、编排器、技能系统、API层 |
| **Python** | 可选绑定层 | Python SDK、模型推理 |

### GUI 控制

**混合方案**:
- **Windows UIA** - 原生 Windows UI 自动化
- **Rust 原生** - 高性能输入模拟、屏幕捕获
- **Playwright CDP** - 浏览器自动化（Web 端）
- **VLM 视觉** - 视觉语言模型驱动的元素识别

### LLM 协议

**OpenAI 协议为主，兼容以下**:
- OpenAI (GPT-4, GPT-4o)
- Anthropic (Claude 3)
- Ollama (本地模型)
- 其他兼容 OpenAI API 的提供商

## 竞品特性对标

### OpenClaw → Multi-Agent Bridge

```rust
// crates/agent-bridge/src/lib.rs
- Agent 注册与发现
- 消息路由（广播/单播/多播）
- 协作模式：并行/顺序/竞争/投票/主从
- 心跳机制与状态同步
- 能力匹配与任务委托
```

### UI-TARS → VLM Connector

```rust
// crates/vlm-connector/src/lib.rs
- 视觉问答（Screenshot + Prompt → Action）
- UI 理解（元素识别、意图理解）
- 动作预测（当前状态 → 下一步操作）
- 多模态模型支持：GPT-4V, Claude 3, Gemini, Qwen-VL, LLaVA
- 坐标精确定位
```

### Hermes → Task Orchestrator

```typescript
// src/orchestrator/*.ts
- 自然语言任务解析
- 自主任务规划（LLM 生成执行图）
- 动态计划调整（Reflection 机制）
- 工具调用协议
- 结果验证与重试
```

## 核心架构

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
├─────────────────────────────────────────────────────────────┤
│                       Skill Registry                         │
│      (Built-in Skills / Custom Skills / Validation)        │
└─────────────────────────────────────────────────────────────┘
```

## 项目结构

```
OpenOxygen/
├── crates/                          # Rust 核心
│   ├── core/                       # 运行时核心
│   ├── gui-control/                # GUI 控制 (Windows UIA + Vision)
│   ├── cli-executor/               # CLI 执行器
│   ├── perception/                 # 感知引擎
│   ├── agent-bridge/               # 多 Agent 通信 (对标 OpenClaw)
│   └── vlm-connector/              # VLM 连接器 (对标 UI-TARS)
│
├── src/                            # TypeScript 业务层
│   ├── orchestrator/               # 任务编排 (对标 Hermes)
│   │   ├── mod.ts                  # 主入口
│   │   ├── planner.ts              # 任务规划
│   │   ├── executor.ts             # 计划执行
│   │   └── context.ts              # 会话管理
│   ├── llm/                        # LLM 网关
│   │   └── gateway.ts              # 多提供商支持
│   └── skills/                     # 技能系统
│       └── registry.ts             # 技能注册与管理
│
├── python/                         # Python SDK
│   └── openoxygen_next/
│       ├── __init__.py             # 主入口
│       └── orchestrator.py         # Python 编排器
│
├── docs/                           # 文档
│   ├── ARCHITECTURE.md             # 架构文档
│   ├── API.md                      # API 文档
│   └── REWRITE_PLAN.md             # 本文件
│
├── Cargo.toml                      # Rust 工作区配置
├── package.json                    # Node.js 配置
├── pyproject.toml                  # Python 配置
├── tsconfig.json                   # TypeScript 配置
├── LICENSE                         # MIT 协议
└── README.md                       # 项目说明
```

## 实施阶段

### Phase 1: 核心运行时 (✅ 完成框架)
- [x] Rust 核心运行时
- [x] TypeScript 编排器框架
- [x] LLM 网关
- [x] 技能注册表

### Phase 2: 执行层 (🔄 进行中)
- [ ] GUI 控制实现 (Windows API)
- [ ] CLI 执行器完善
- [ ] 屏幕捕获
- [ ] VLM 连接器

### Phase 3: 多 Agent (📋 计划中)
- [ ] Agent 发现服务
- [ ] 消息路由
- [ ] 协作编排
- [ ] 状态同步

### Phase 4: 感知层 (📋 计划中)
- [ ] OCR 集成
- [ ] 元素检测
- [ ] 视觉匹配
- [ ] VLM 微调接口

### Phase 5: 集成测试 (📋 计划中)
- [ ] 端到端测试
- [ ] 性能基准
- [ ] 竞品对比

## 版本号策略

- Workspace 开发：**无需版本号**
- 首次 Release：**1.0.0**
- 语义化版本：MAJOR.MINOR.PATCH

## 关键决策

### 为什么选择 Rust + TypeScript?
- Rust: 性能关键（GUI 控制、屏幕捕获）
- TypeScript: 业务逻辑灵活性（LLM 编排、API 层）

### 为什么 VLM 优先?
- 对标 UI-TARS 的视觉驱动方式
- 更灵活，不需要精确的 UI 选择器
- 适应 UI 变化的能力更强

### 为什么多 Agent?
- 对标 OpenClaw 的分布式架构
- 专业化分工（GUI Agent, CLI Agent, Browser Agent）
- 水平扩展能力

## 构建命令

```bash
# Rust 构建
cargo build --release

# TypeScript 构建
npm run build

# Python 构建 (Maturin)
maturin develop
maturin build --release

# 完整构建
npm run build:full
```

## 测试策略

```bash
# Rust 测试
cargo test

# TypeScript 测试
npm test

# Python 测试
pytest

# 集成测试
npm run test:e2e
```

## 竞品对比矩阵

| 特性 | OpenOxygen Next | OpenClaw | UI-TARS | Hermes |
|------|-----------------|----------|---------|--------|
| 视觉 GUI | ✅ VLM | ❌ | ✅ 核心 | ❌ |
| 多 Agent | ✅ 桥接 | ✅ 核心 | ❌ | ⚠️ |
| LLM 编排 | ✅ 自研 | ⚠️ | ❌ | ✅ 核心 |
| CLI 集成 | ✅ 原生 | ✅ | ❌ | ✅ |
| 开源 | ✅ | ✅ | ✅ | ✅ |
| Windows 原生 | ✅ | ✅ | ❌ | ❌ |

---

**目标**: 站在第一梯队，干掉竞品
**策略**: 融合三家之长，形成差异化优势
**野心**: 不要写在文档里 ;)
