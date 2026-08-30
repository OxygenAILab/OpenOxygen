# OpenOxygen Next — 架构决策记录

> 最后更新：2026-07-27
> 决策者：泽川 + 小氧

## 核心决策：TypeScript-First Architecture

### 背景

Phase 2 执行层曾尝试 Rust + TypeScript 双实现：
- **Rust 侧**：完整的 `vlm-connector`（10 个测试通过）、`windows_impl.rs`（386 行真 Win32 代码）
- **TypeScript 侧**：`PlanExecutor`、`WindowsGuiController`（PowerShell 调 Win32）、Vision 集成
- **现状**：两套实现之间**零桥接**（无 napi/FFI/子进程/HTTP），Rust 的 vlm-connector 产出 `PredictedAction` 无人消费，`windows_impl.rs` 是编译不进的孤儿代码

### 问题诊断

**技术债累积速度 > 新功能开发速度**：
1. **Planner 层缺失** —— LLM 生成 `PlanStep[]` 的逻辑不存在，所有测试都是手写 step
2. **维护成本翻倍** —— 改一个功能要改两遍，但实际只有 TS 在跑
3. **决策瘫痪** —— 方案 B（修 Rust 闭环）需接线 windows_impl.rs + 写转换代码，方案 C（定桥接）需 napi-rs 学习成本，两者都是巨坑所以一直拖着
4. **横向铺太多半成品** —— 想做 GUI + CLI + Browser，但只有 GUI 半成品；想做 Vision + UIA，但 Vision 因硬件跑不起来

**真正的瓶颈**：Agent 的智能（Planner、错误恢复、任务理解），而不是执行速度（UIA 定位 2-6 秒已够用，点击毫秒级）。

### 决策：All-in TypeScript

**原则**：深度优先 > 广度优先，一个领域做到极致 > 横向铺很多半成品

**架构**：
```
┌─────────────────────────────────────────────┐
│         TypeScript Main Logic               │
│  • src/orchestrator/planner.ts  (核心！)    │
│  • src/orchestrator/executor.ts             │
│  • src/execution/vision/                    │
│  • src/gui/windows.ts                       │
├─────────────────────────────────────────────┤
│   Native Acceleration (napi addons)         │
│   • crates/vlm-connector (VLM 推理)         │
│   • crates/memory (向量检索，未来)          │
└─────────────────────────────────────────────┘
```

**保留的 Rust crates**：
- ✅ `vlm-connector` —— 编译成 napi addon，供 TS 调用（已有 10 个测试，不浪费投入）
- ✅ `memory` —— 未来向量检索可能成为性能瓶颈时编译成 addon

**弃用的 Rust crates**（注释掉，但保留代码以备将来参考）：
- ❌ `core` —— 执行器逻辑移到 `src/orchestrator/executor.ts`
- ❌ `gui-control` —— GUI 自动化用 `nut-js`（短期）或 napi 包装（长期）
- ❌ `cli-executor` —— CLI 用 Node.js `child_process`
- ❌ `browser-executor` —— 浏览器自动化用 Playwright
- ❌ `htn-planner` —— 规划逻辑移到 `src/orchestrator/planner.ts`
- ❌ `agent-bridge`, `perception`, `ouv` —— TS-first 架构中不需要

### 理由

1. **生态优势**：
   - TS：`npm install` 一行解决（Playwright、nut-js、@anthropic-ai/sdk）
   - Rust：Anthropic/OpenAI SDK 是二等公民，GUI 库要自己写
   
2. **开发速度**：
   - TS：明天就能推进 Planner（核心价值）
   - Rust：未来 2-3 周补 windows_impl.rs + napi 桥接，期间 Planner 停滞

3. **性能不是瓶颈**：
   - Agent 的延迟来自 LLM 推理（秒级），不是坐标计算（毫秒级）
   - 类比：Anthropic Computer Use Demo 是 Python，OpenAI Operator 是 TS

4. **渐进式优化路径**：
   - 短期：PowerShell → nut-js（FFI 调 Win32，1ms）
   - 长期：性能热点编译成 napi addon（测量 → 优化，而不是猜测）

### 后果

**优势**：
- ✅ 集中 80% 精力在 Planner（LLM prompt、任务分解、错误恢复）
- ✅ 避免"两边都不完整"的技术债
- ✅ Rust 投入不浪费（vlm-connector 编译成 addon）

**代价**：
- ⚠️ 短期内放弃"Rust 核心的高性能 Agent"愿景
- ⚠️ Rust crates 的代码暂时不维护（但保留以备参考）

**风险缓解**：
- 性能热点通过 napi 逐步迁移回 Rust（vlm-connector 是第一个）
- 如果未来发现 TS 真的成为瓶颈，再考虑 Rust 重写（数据驱动决策）

---

## 执行层技术栈

### GUI 自动化

**当前（Phase 2 已验证）**：
- UIA 第 1 级：PowerShell 调 `System.Windows.Automation`（快速定位，零 VLM token）
- VLM 第 2 级：Ollama qwen3-vl 视觉兜底（处理 canvas/游戏 UI）

**短期升级（1-2 周）**：
```bash
npm install @nut-tree/nut-js
```
- 替换 PowerShell 字符串拼接为 nut-js FFI 调用
- 性能提升：50ms → 1ms
- 安全性提升：类型校验，防注入

**长期优化（3-6 个月，如果真的成为瓶颈）**：
- 将 `crates/gui-control/src/windows_impl.rs` 编译成 napi addon
- TS 侧无感调用 `import { click } from './native/gui.node'`

### Vision 集成

**当前**：
- `src/execution/vision/index.ts` 调 Ollama `/api/chat`
- 图片放进 `messages[].images`（裸 base64，已修复之前的 bug）
- 模型：qwen3-vl:4b（受硬件限制 OOM，但 UIA 已覆盖常见场景）

**短期优化（Planner 完成后）**：
- Prompt 工程：few-shot、schema validation
- 输出解析增强：重试机制、fallback 到更小模型
- 缓存：同一截图避免重复调 VLM

**长期（如果 VLM 成为性能瓶颈）**：
- `crates/vlm-connector` 编译成 napi addon
- TS 调用 Rust 做推理（减少序列化开销）

### CLI / Browser

- **CLI**：Node.js `child_process`（已够用）
- **Browser**：Playwright（成熟方案，无需重新造轮子）

---

## 优先级

### 第 1 优先级：Planner（80% 精力）

**当前状态**：`src/orchestrator/planner.ts` 只定义类型，无实现

**目标**：从自然语言 → `PlanStep[]`

**实现路径**：
1. 最简单 Prompt：让 LLM 输出 JSON 格式的 `PlanStep[]`
2. 验证：能否从"打开记事本输入 hello"生成可执行 plan
3. 迭代：few-shot、CoT、错误恢复

### 第 2 优先级：可观测性（15% 精力）

- 结构化日志（JSON）
- 每个 step 的开始/结束/耗时/结果
- 失败时能回溯完整链路

### 第 3 优先级：性能优化（5% 精力）

- 等真的成为瓶颈再说
- 测量 → 优化（数据驱动），而不是猜测

---

## 参考

- Anthropic Computer Use Demo：Python + Playwright
- OpenAI Operator：TypeScript + Playwright
- 过早优化是万恶之源（Donald Knuth）

---

## 变更历史

- 2026-07-27：决定 All-in TypeScript，弃用 Rust 执行层（保留 vlm-connector/memory 作为 napi addon）
