# OpenOxygen Next 项目结构说明

## 项目概述

OpenOxygen Next 是下一代计算机使用智能体框架，基于五层分层解耦架构设计，实现了多语言、跨平台的自动化能力。

**核心技术栈**:
- Rust（性能关键组件）
- TypeScript（业务逻辑层）
- Python（可选绑定层）
- Tauri v2 + React + WinUI3（桌面端）

---

## 目录结构

```
OpenOxygen/
├── crates/                    # Rust 核心组件（工作区）
│   ├── core/                  # 核心运行时
│   ├── gui-control/           # GUI 控制引擎
│   ├── cli-executor/          # CLI 执行器
│   ├── htn-planner/           # HTN 任务规划器
│   ├── perception/            # 感知模块（OCR等）
│   ├── agent-bridge/          # Agent 桥接层
│   ├── vlm-connector/         # VLM 连接器
│   ├── memory/                # 持久化记忆
│   ├── ouv/                   # OxygenUltraVision 视觉模块
│   └── ollama/                # Ollama 本地模型集成
│
├── src/                       # TypeScript 业务逻辑层
│   ├── access/                # 统一接入与兼容层
│   │   ├── gateway/           # 统一网关
│   │   └── compatibility/     # OpenClaw 兼容适配器
│   ├── inference/             # 融合式推理与规划中枢
│   │   ├── engine/            # 推理引擎
│   │   ├── planner/           # 任务规划器
│   │   ├── reflection/        # 反思模块
│   │   └── router/            # 模型路由
│   ├── execution/             # 统一执行引擎
│   │   ├── gui/               # GUI 自动化控制
│   │   ├── browser/           # 浏览器自动化
│   │   └── vision/            # 视觉执行模块
│   ├── memory/                # 分层记忆与持久化层
│   │   ├── short-term/        # 短期会话记忆
│   │   ├── mid-term/          # 中期任务记忆
│   │   └── long-term/         # 长期知识记忆
│   ├── security/              # 安全与审计层
│   │   ├── permissions/       # 权限管理
│   │   └── audit/             # 审计日志
│   ├── llm/                   # LLM 网关与路由
│   ├── skills/                # 技能注册与管理
│   ├── orchestrator/          # 任务编排器
│   ├── browser/               # 浏览器控制器
│   ├── ollama/                # Ollama 管理器
│   └── index.ts               # 主入口
│
├── python/                    # Python 绑定层
│   └── openoxygen_next/       # Python 包
│
├── docs/                      # 项目文档
├── .github/workflows/         # CI/CD 配置
└── 配置文件
    ├── Cargo.toml             # Rust 工作区配置
    ├── package.json           # Node.js 配置
    ├── tsconfig.json          # TypeScript 配置
    └── pyproject.toml         # Python 配置
```

---

## 五层架构详解

### 1. 统一接入与兼容层 (`src/access/`)

负责处理不同渠道的请求，提供统一的接口标准。

| 模块 | 功能 | 文件 |
|------|------|------|
| 统一网关 | 接收和分发任务、技能、记忆等请求 | `access/gateway/index.ts` |
| OpenClaw 兼容 | 提供与 OpenClaw 协议的兼容性 | `access/compatibility/index.ts` |

**关键接口**:
- `UnifiedGateway`: 统一网关处理器，支持 websocket/http/stdio 三种传输方式
- `OpenClawCompatAdapter`: OpenClaw 协议兼容适配器

---

### 2. 融合式推理与规划中枢 (`src/inference/`)

核心推理引擎，支持多模型提供商和自适应推理模式。

| 模块 | 功能 | 文件 |
|------|------|------|
| 推理引擎 | 执行 LLM 调用，支持 OpenAI/Anthropic/Gemini/Ollama | `inference/engine/index.ts` |
| 任务规划器 | 将自然语言转换为可执行步骤 | `inference/planner/index.ts` |
| 反思模块 | 执行后反思与自我修正 | `inference/reflection/index.ts` |
| 模型路由 | 根据任务复杂度自动选择模型 | `inference/router/index.ts` |

**推理模式**:
- `fast`: 简单问题，使用轻量模型
- `balanced`: 中等复杂度，标准模型
- `deep`: 复杂推理，高级模型

**支持的模型提供商**:
- OpenAI / OpenRouter / StepFun（兼容 OpenAI API）
- Anthropic（Claude）
- Google Gemini
- Ollama（本地模型）

---

### 3. 统一执行引擎 (`src/execution/`)

执行层，负责 GUI、CLI、浏览器等自动化操作。

| 模块 | 功能 | 文件 |
|------|------|------|
| GUI 控制 | 模拟鼠标点击、键盘输入等操作 | `execution/gui/index.ts` |
| 浏览器控制 | 网页自动化，支持导航、点击、输入 | `execution/browser/index.ts` |
| 视觉执行 | 基于视觉的定位和操作 | `execution/vision/index.ts` |

**GUI 操作类型**:
- 坐标点击、文本输入、滚动、拖拽、等待、截图
- UIA 元素定位、图像匹配、OCR 文本查找、LLM 引导定位

---

### 4. 分层记忆与持久化层 (`src/memory/`)

多层次记忆系统，支持会话、任务、长期知识的存储与检索。

| 模块 | 功能 | 文件 |
|------|------|------|
| 短期记忆 | 会话级别，存储当前会话上下文 | `memory/short-term/index.ts` |
| 中期记忆 | 任务级别，存储任务执行轨迹 | `memory/mid-term/index.ts` |
| 长期记忆 | 知识库级别，存储事实、规则、偏好等 | `memory/long-term/index.ts` |

**长期记忆结构**:
- 记忆条目（fact/rule/experience/preference/knowledge）
- 知识图谱（节点 + 边关系）
- 置信度验证机制

---

### 5. 安全与审计层 (`src/security/`)

提供细粒度权限管理和不可篡改审计日志。

| 模块 | 功能 | 文件 |
|------|------|------|
| 权限管理 | 控制不同操作的访问权限 | `security/permissions/index.ts` |
| 审计日志 | 记录所有操作，支持查询和导出 | `security/audit/index.ts` |

**审计动作类型**:
- 任务操作：task_start、task_complete、task_failed
- 技能操作：skill_executed
- 权限操作：permission_granted、permission_denied
- 记忆操作：memory_read、memory_write
- 系统操作：network_request、system_command、file_access

---

## Rust 核心组件 (`crates/`)

### core
核心运行时，负责任务调度、状态管理和事件循环。

| 文件 | 功能 |
|------|------|
| `lib.rs` | CoreRuntime 实现 |
| `scheduler.rs` | 任务调度器 |
| `state.rs` | 全局状态管理 |
| `error.rs` | 错误类型定义 |

### gui-control
GUI 控制引擎，基于 Windows UIA 和计算机视觉。

| 文件 | 功能 |
|------|------|
| `lib.rs` | GuiController 实现 |
| `capture.rs` | 屏幕捕获 |
| `uia.rs` | UIA 自动化 |
| `input.rs` | 输入模拟 |
| `windows_impl.rs` | Windows 平台实现 |

### htn-planner
层次化任务网络规划器，支持任务分解、前置条件检查、冲突消解。

| 文件 | 功能 |
|------|------|
| `lib.rs` | HtnPlanner 核心实现 |
| `executor.rs` | 计划执行器 |

### vlm-connector
视觉语言模型连接器。

| 文件 | 功能 |
|------|------|
| `lib.rs` | VLM 连接器核心 |
| `providers/openai.rs` | OpenAI VLM 提供商 |

### perception
感知模块，包含 OCR 和其他感知能力。

| 文件 | 功能 |
|------|------|
| `lib.rs` | 感知模块核心 |
| `ocr.rs` | OCR 识别 |

### agent-bridge
Agent 桥接层，连接不同 Agent 系统。

### memory
持久化记忆模块，提供内存和磁盘存储支持。

### ouv
OxygenUltraVision，视觉理解模块。

### ollama
Ollama 本地模型集成。

### cli-executor
CLI 命令执行器。

---

## 技能系统 (`src/skills/`)

技能注册和管理系统，负责注册、执行技能。

| 文件 | 功能 |
|------|------|
| `registry.ts` | SkillRegistry 类，技能注册中心 |
| `builtin.ts` | 内置技能定义（GUI/CLI/浏览器/系统） |

**技能分类**:
- `gui`: GUI 自动化技能（点击、输入、截图、查找元素）
- `cli`: 命令行技能（执行命令、启动进程）
- `browser`: 浏览器技能（导航、点击、输入）
- `system`: 系统技能（等待、内存存储/检索）

---

## 任务编排器 (`src/orchestrator/`)

将自然语言转换为可执行任务图的核心组件。

| 文件 | 功能 |
|------|------|
| `mod.ts` | 编排器入口，TaskOrchestrator 类 |
| `planner.ts` | 任务规划器，生成执行步骤 |
| `executor.ts` | 计划执行器，执行步骤序列 |
| `context.ts` | 会话上下文管理 |

**执行流程**:
1. 任务理解（LLM 分析用户意图）
2. 任务规划（生成执行计划）
3. 计划执行（执行步骤序列）
4. 结果反思（可选）
5. 生成摘要

---

## LLM 网关 (`src/llm/`)

| 文件 | 功能 |
|------|------|
| `gateway.ts` | LLMGateway 类，统一 LLM 接口 |
| `router.ts` | LLM 路由器，选择最优模型 |

---

## 浏览器控制 (`src/browser/`)

| 文件 | 功能 |
|------|------|
| `controller.ts` | BrowserController 类，浏览器会话管理 |

---

## Ollama 管理 (`src/ollama/`)

| 文件 | 功能 |
|------|------|
| `manager.ts` | OllamaManager 类，本地模型管理 |

---

## 文件分类标准

### 按功能分类

| 分类 | 路径 | 说明 |
|------|------|------|
| 核心逻辑 | `src/` | TypeScript 业务逻辑 |
| Rust 组件 | `crates/` | Rust 性能关键组件 |
| Python 绑定 | `python/` | Python 调用接口 |
| 文档 | `docs/` | 项目文档 |
| CI/CD | `.github/workflows/` | 持续集成配置 |

### 按层级分类

| 层级 | 路径 | 说明 |
|------|------|------|
| 接入层 | `src/access/` | 统一接入与兼容 |
| 推理层 | `src/inference/` | 推理与规划 |
| 执行层 | `src/execution/` | 任务执行 |
| 记忆层 | `src/memory/` | 记忆存储 |
| 安全层 | `src/security/` | 权限与审计 |

### 文件命名规范

- **模块入口**: `index.ts`
- **类型定义**: `types.ts`
- **工具函数**: `utils.ts`
- **测试文件**: `*.test.ts`
- **示例代码**: `examples/`

---

## 关键模块说明

### TaskOrchestrator
**位置**: `src/orchestrator/mod.ts`

任务编排器是系统的核心调度组件，负责：
- 接收自然语言任务请求
- 使用 LLM 分析任务意图
- 生成详细的执行计划
- 调度执行引擎执行步骤
- 收集结果并生成摘要

### LLMGateway
**位置**: `src/llm/gateway.ts`

LLM 网关提供统一的 LLM 调用接口，支持多提供商切换：
- OpenAI 及兼容接口
- Anthropic Claude
- Google Gemini
- Ollama 本地模型

### SkillRegistry
**位置**: `src/skills/registry.ts`

技能注册中心，管理所有可用技能：
- 注册/注销技能
- 按分类查询技能
- 执行技能
- 技能状态管理

### GuiController (Rust)
**位置**: `crates/gui-control/src/lib.rs`

GUI 控制引擎，基于 Windows UIA 和计算机视觉：
- 屏幕捕获
- UIA 元素定位和操作
- 图像匹配
- OCR 文本识别
- LLM 引导视觉定位

### HtnPlanner (Rust)
**位置**: `crates/htn-planner/src/lib.rs`

HTN 规划器，实现层次化任务网络规划：
- 任务分解（复合任务 → 原始任务）
- 前置条件检查
- 效果应用
- 冲突检测与消解
- 回溯策略

---

## 配置文件说明

### Cargo.toml
Rust 工作区配置，定义成员 crates 和共享依赖。

### package.json
Node.js 项目配置，包含脚本和依赖。

**常用脚本**:
- `npm run build`: 构建 TypeScript
- `npm run build:watch`: 增量构建
- `npm run build:rust`: 构建 Rust 组件
- `npm test`: 运行测试
- `npm run lint`: 代码检查

### tsconfig.json
TypeScript 编译配置，target 为 ES2022，module 为 commonjs。

### pyproject.toml
Python 包配置，提供 Python 绑定。

---

## 版本信息

- **项目版本**: 1.26.149（package.json）
- **Rust 版本**: 1.0.0（Cargo.toml）
- **TypeScript**: 5.2.0+
- **Node.js**: >=18.0.0

---

## 参考文档

- [技术架构白皮书](docs/ARCHITECTURE.md)
- [API 文档](docs/API.md)
- [开发进度](docs/PHASE2_STATUS.md)