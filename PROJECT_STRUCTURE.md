# OpenOxygen Next 项目结构说明

> 2026-08-31 更新:本文档反映 All-in TypeScript 重构后的真实结构。
> 旧版描述(Rust 执行层/Python 绑定层/Tauri 桌面端)已弃用,见 `ARCHITECTURE.md`。

<!-- GitHub@NDBlockConnect | BlockConnect@StarsailsClover -->

## 项目概述

OpenOxygen Next 是视觉优先的 Computer Use Agent(版本 v26.0-Alpha 2)。
TypeScript-first 架构:robotjs 桌面控制 + 四 provider 多模态推理引擎 + AgentLoop 感知-决策-行动闭环。

## 目录结构

```
OpenOxygen/
├── src/                        # 源代码(TS)
│   ├── gui/                    #   robotjs GUI 控制器(SendKeys 组合键/真 PNG 截图)
│   ├── orchestrator/           #   AgentLoop(主路径)/ PlanExecutor(批处理)/ planner / 错误恢复
│   ├── inference/engine/       #   推理引擎:四 provider(openai/anthropic/gemini/ollama)
│   │                           #   多模态图像编码 + 工具调用(tools)声明与解析
│   ├── execution/vision/       #   VLM 截图分析/findElement
│   ├── observability/          #   JSON Lines 日志 + 指标收集
│   ├── cli/                    #   NodeCliExecutor
│   ├── memory/                 #   短/中/长期记忆
│   └── index.ts                #   OpenOxygen 主类 + CLI 入口(openoxygen agent/chat/execute)
├── scripts/                    # 测试/演示脚本(e2e、mock-brain、真实 API 验证、基准)
├── docs/                       # 项目文档
├── memory/                     # 跨会话状态:FACT.md(事实)+ JOURNAL.jsonl(事件流)
├── crates/                     # Rust crates(执行层已弃用,vlm-connector/memory 保留为未来 addon)
├── .github/                    # CI
├── .devlogs/ .devdocs/ 等      # BC 工作区模板目录(指针见各自 README)
└── dist/                       # 构建产物(gitignore)
```

## 关键链路

| 路径 | 说明 |
|---|---|
| `openoxygen agent "目标"` | **主路径**:AgentLoop——LLM 每步看观察(截图/UIA/CLI 输出)自主决定工具,直到 finish |
| SimplePlanner → PlanExecutor | 可选批处理模式:一次性生成静态计划再执行 |
| 视觉兜底 | UIA 定位优先(零 token)→ VLM findElement 兜底(真 PNG 截图) |

## 相关文档

- `ARCHITECTURE.md`:架构决策记录(All-in TypeScript ADR)
- `CHANGELOG.md`:版本变更
- `memory/FACT.md`:持久知识(现状/教训/陷阱)
- `docs/`:阶段文档与发布说明
