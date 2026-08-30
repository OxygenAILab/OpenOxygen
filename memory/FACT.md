# OpenOxygen Next — 项目事实

> 持久知识：架构、关键设计决策、模块现状。会话事件记入 JOURNAL.jsonl。

## 项目概览

- **OpenOxygen Next**：视觉优先的 Computer Use Agent，版本 26.0.0-alpha.1，处于 Phase 2（执行层）。
- **灵感来源**：OpenClaw（多 Agent）、UI-TARS（视觉 GUI）、Hermes（LLM 编排）。
- **架构决策（2026-07-27 重构）**：**TypeScript-first**，Rust 仅作为性能加速库（napi addon）。
  - 主执行链路：TS（`src/`）使用 robotjs 实现 GUI 控制
  - Rust crates（`crates/vlm-connector`、`memory`）保留，未来按需编译成 napi addon
  - **已弃用**：Rust 执行层 crates（`core`、`gui-control` 等 9 个），见 `Cargo.toml` 注释
  - **理由**：避免双实现维护成本、Planner 是瓶颈（非执行速度）、TS 生态优势

## 构建 / 测试命令

- Rust：`cargo test -p <crate>`、`cargo check --workspace`。
- TS：`npx tsc --noEmit`（类型检查）、`npx jest`（测试）。
- TS 测试基建：jest + ts-jest 已装但**原先缺配置**，已补 `jest.config.js`（2026-07）。测试文件放在 `src/**/​*.test.ts`。

## 执行层现状（Phase 2）

### TS 链路（完整端到端已通）✅
- **入口**：`src/index.ts` → `orchestrator/executor.ts::PlanExecutor`。
- **规划层（2026-07-27 实现）**：
  - `src/orchestrator/simple-planner.ts::SimplePlanner`：调用 Ollama（qwen2.5:7b）将自然语言转换为 `PlanStep[]`
  - System prompt 定义可用步骤类型、规划原则、输出格式
  - JSON 提取（处理 LLM markdown 包裹）、步骤验证（target、依赖、超时）
  - 简化接口：`generatePlan(description, mode, context)`
- **GUI 执行（2026-07-27 升级）**：
  - **主路径**：`src/gui/robot.ts::RobotGuiController` —— robotjs（FFI 调 Win32），性能 ~15ms/次（PowerShell ~50ms，提升 3 倍）
  - 坐标校验（防注入、越界、NaN）、鼠标操作、键盘操作、截图
  - **备用**：`src/gui/windows.ts::WindowsGuiController`（PowerShell 实现，保留但不再是主路径）
- **UIA 定位**：`windows.ts::locateByDescription` —— 系统级元素定位（2-6 秒，零 VLM token）
- **视觉兜底**：`src/execution/vision/index.ts` —— Ollama VLM（qwen3-vl）分析截图
- **目标定位**：`resolveGuiTarget` 两级 fallback —— UIA 第 1 级 → 视觉第 2 级
- **Executor 动作分发（2026-07-26 修复并验证）**：
  - `executeStep` 的 switch 分发正确路由 `gui_click`/`gui_type`/`gui_wait_for`/`gui_screenshot` 等动作。
  - 修复了方法调用不匹配（`typeText`→`type_text`、`keyCombo`→`key_press`、`click` 的 button 参数路由到 `right_click`/`double_click`）。
  - 测试脚本 `scripts/test-executor-dispatch.ts` 验证通过，所有 GUI 动作能正确执行。
- **实机验证**：
  - **2026-07-26**：
    - 冒烟测试 `scripts/smoke-gui-locate.ts` —— UIA 定位成功，坐标准确，耗时 2-3 秒
    - 端到端测试 `scripts/e2e-gui-click.ts` —— 定位 → 移动 → 点击全链路通过
    - Executor 分发测试 `scripts/test-executor-dispatch.ts` —— 3/3 动作类型验证通过
  - **2026-07-27**：
    - robotjs 性能测试 `scripts/test-robot-gui.ts` —— 坐标校验 3/3、移动精度 0px、性能 15.6ms/次 ✓
    - **完整链路测试 `scripts/test-executor-manual-plan.ts` —— 9/9 步骤成功，4.2 秒，记事本打开并输入文本 ✓**
  - VLM 第 2 级受硬件限制（qwen3-vl:4b OOM），但不影响主流程（UIA 已覆盖常见场景）
  - **核心结论**：Planner → Executor → GUI 完整链路已打通 🎉

### Rust 链路（2026-07-27 已弃用执行层）
- **已注释掉**（`Cargo.toml`）：`core`、`gui-control`、`cli-control`、`browser-control`、`htn-planner`、`scheduler`、`agent-bridge`、`ouv`、`http-server` 共 9 个执行层 crate
- **保留**：`vlm-connector`、`memory` —— 未来按需编译成 napi addon
- **原因**：Rust/TS 双实现维护成本过高，两边都不完整，零桥接，Rust 代码永远不会被执行
- **未来路径**：TS 热点性能瓶颈时，将 Rust crate 编译成 napi addon 给 TS 调用

## VLM Connector（Rust，2026-07 实现）

- `crates/vlm-connector/src/lib.rs`：新增 Ollama 视觉后端。
- **关键正确做法**：Ollama `/api/chat` 的图片必须放进 `messages[].images` 数组，且是**裸 base64**（不含 data URI 前缀，不塞进 content 文本）。vision 模型（qwen3-vl、llava）才能看到图。
- 设计：纯函数（`build_ollama_chat_body`、`parse_ollama_chat_response`、`parse_predicted_action`、`extract_json_object` 等）与网络层分离，便于离线单测。
- **方案A 决策**：`execute_step`（调度路径）在无真实后端时优雅降级到占位响应，而非失败；但公共 `ask()`/`predict_action()` 对非 Ollama provider 仍诚实返回 `NotImplemented`。

## TS 推理引擎（2026-07 修复）

- `src/inference/engine/index.ts`：`ChatMessage` 加 `images?` 字段；新增 `stripDataUriPrefix`、`buildOllamaMessages`；`callOllama` 正确把图片放进 `messages[].images`。
- 修复前的 bug：`vision/index.ts` 把图片塞进 content 文本 `[图片: data:...]`，模型根本看不到 —— 视觉实际失效。已改为放 `images` 字段。

### OpenAI 兼容路径视觉修复（2026-08-22 新增）

- **问题**：`callOpenAICompatible` 直接透传 `request.messages`，非标准 `images` 字段（裸 base64）会被真实 OpenAI/兼容服务端静默丢弃 → 走 OpenAI 格式的 API Key 测视觉必然失效。
- **修复**：新增 `buildOpenAIMessages` + `ensureDataUriPrefix`——有图时 content 转为多模态数组 `[{type:'text'},{type:'image_url',image_url:{url:'data:image/png;base64,...'}}]`；无图保持纯字符串不变。
- **协议等价性结论**：Ollama 与 OpenAI 格式在文本层互通（Ollama 也提供 `/v1/chat/completions`），但图像载荷不同：Ollama 原生放 `messages[].images`（裸 base64），OpenAI 放 content 多模态数组（data URI）。引擎现在两条路径都正确处理。
- **验证**：单元测试 6 例（openai-images.test.ts）；端到端经 mock-brain openai 路由发真截图 → 服务端 PNG 魔数校验通过并解码落盘 → 握手响应正确返回。
- **范围说明**：Anthropic/Gemini 路径仍为纯文本（未做各自的多模态转换），需要时再补。

### 四供应商多模态统一（2026-08-22 续）

- **Anthropic**：新增 `buildAnthropicMessages`——有图时 content 为块数组 `{type:'image',source:{type:'base64',media_type,data}}`，data 必须是**裸 base64**（用 `stripDataUriPrefix` 剥前缀）；MIME 按魔数检测（新增 `detectImageMime`：PNG/JPEG/GIF/WEBP，未知默认 png）。
- **Gemini**：新增 `buildGeminiContents`——图像走 `{inlineData:{mimeType,data}}` part（v1beta REST 驼峰格式），data 同样裸 base64；顺带修复 **systemPrompt 完全被忽略**的缺口（现在走 `systemInstruction.parts[].text`）。
- **mock-brain 扩展**：新增 `/v1/messages`（anthropic）与 `/models/*:generateContent`（gemini）两套路由+解析+响应包装；修了一个真 bug——URL 匹配未剥离查询串，gemini 的 `?key=xxx` 会让 `$` 锚点正则失配返回 404。已知展示性瑕疵：gemini 请求体无顶层 model 字段（模型名在 URL），日志显示 model=unknown 属正常。
- **验证**：单元测试 +11 例（anthropic-gemini-images.test.ts），jest 总数 21→32 全过、tsc 0 错误；端到端 `scripts/test-all-providers-vision-mock.ts` 四路由各发一张真截图，服务端日志确认 **4×imgs=1 且全部通过 PNG 魔数校验**。
- **结论**：无论未来的 API Key 是 OpenAI/Anthropic/Gemini 格式还是本地 Ollama，视觉链路开箱即用。

## 严格审计与真实 API 验证（2026-08-30）

**真实 API**：OpenAI 兼容网关（NewAPI），Key 走 `.env`（已 gitignore）的 `OPENOXYGEN_PLANNER_API_KEY/MODEL/BASE_URL`。
- ✅ 文本链路：引擎→SimplePlanner 真实出 7 步合法计划（glm-5.3-flash，13.7s），键盘优先策略被模型正确遵循
- ⚠️ 视觉：glm-5.3-flash **有视觉能力**（裸 HTTP 曾成功描述屏幕），但网关 vision 上游通道间歇 403 upstream_unavailable（裸 HTTP 与引擎同样失败→网关侧问题，非代码）；格式正确性已由 mock 四路由 e2e 背书
- ⚠️ 推理模型特性：glm-5.3-flash 响应带 `reasoning_content`，小 max_tokens 时推理吃光预算→content 为空→JSON 提取失败。引擎只读 content，**不透出 reasoning**（P2 待办：考虑透出或告警）

**严格审计核心发现**（explore agent 全文重读 executor.ts/planner.ts/robot.ts，23 项）：
- **P0-1** `executor.ts:575` validateStep 是永远 success 的空壳，而 robotjs 动作失败返回 `{success:false}` 不抛错 → **所有 GUI 失败被上报为成功**
- **P0-3** `executor.ts:568` 依赖检查逻辑失效（completedIds 含所有结果使 success 子句永不可达）→ 失败的依赖算满足
- **P0-4** 空串 gui_type 是零事件 no-op 仍计成功 → **历史"9/9 全过"确认空心**（test-executor-manual-plan.ts:56,102 的 `text:''`）
- **P0-5** robotjs `screenshot()` 返回裸 bitmap 却当 PNG 用 → 视觉兜底 VLM 永远收损坏图（robot.ts:236-243）
- **P0-2** executeStream 传 `null as any` context 首步必崩
- P1 重点：handleFailure 丢弃重试成功结果；恢复策略写入 executor 从不读的字段（shouldRelocate 从未消费）；condition 步骤恒真且 then/else 均不执行；`+{TAB}`/`{F1}-{F12}` 组合键损坏；buildDependencyMap 用未 enrich 的原始步骤；mergeShortSteps 产出 executor 不支持的 parallel 类型；并发执行共享可变状态
- P2：validateAndEnrichSteps 对键盘型 gui_type 无 target 的告警过严（真实计划 step1/3/4/6 全误报）；test 脚本 process.exit 触发 libuv assertion 噪声

**BC 项目管理合规差距**（规范适用部分逐条对照）：
1. ❌ **Git 控制**：91 修改+36 未追踪全部堆在 main 未提交（周级工作量无入库，数据丢失风险）；违反"主版本独立分支开发"
2. ⚠️ **版本一致**：package.json `26.0.0-alpha.1`≈BC 格式；VERSION.txt 仍是旧方案 `1.26.149-next-20260530`
3. ✅ **密钥卫生**：工作树无硬编码 key；git 历史仅 .env.example 占位符（`-S 'sk-'` 命中为 task-/risk- 类误报+模板行）；Cerebras 泄漏声明核实属实
4. ⚠️ 文档语言（英文为主+中文副本）仅 docs/ALPHA1_RELEASE 遵守；CHANGELOG 滞后；水印规范未在代码中实施（追溯成本高，待拍板）
5. ✅ 测试基建：jest 32/32、tsc 0 错误、mock-brain 四路由、真实 API 双通道脚本（test-real-api.ts）

## 架构决策记录（2026-07-27）

**决策**：All-in TypeScript，Rust 仅作为性能加速库

**背景**：
- Rust/TS 双实现维护成本翻倍，两边都不完整，零桥接
- Planner（任务规划）是当前核心瓶颈，而非执行速度
- TS 生态优势（npm install 一行 vs Rust 自己造轮子）

**方案对比**：
- ❌ 方案 B（修 Rust 闭环）：需 2-3 周补 `windows_impl.rs` + 写转换，期间 Planner 停滞
- ❌ 方案 C（Rust↔TS 桥接）：引入 napi 复杂度，学习成本高
- ✅ **方案 A（TypeScript-first）**：马上能推进 Planner，执行层用 robotjs，性能瓶颈时再上 napi addon

**结果**：
- ✅ robotjs 集成完成，性能提升 3 倍（15ms vs 50ms）
- ✅ SimplePlanner 实现完成，接入 Ollama
- ✅ 完整链路验证通过（9/9 步骤，4.2 秒）
- ✅ 技术债清理：Rust 执行层 crate 注释掉，代码保留可随时恢复

**详见**：`REFACTOR_SUMMARY.md`、`ARCHITECTURE.md`

## 已知的良性警告（非本次引入，功能未接通的占位死代码）

- `crates/memory`：`generate_embedding` 的 `text` 参数未用、`VectorStore.dim` 字段未读（embedding/向量检索仍 stub）。
- `crates/htn-planner`：`HtnPlanner.domain`/`world_state` 字段未读。
- 建议：等对应功能实现时自然消除，不加 `_`/`#[allow]` 掩盖真实待办。

## 无 API Key 测试基建（2026-08-22 新增）

**问题**：SimplePlanner 需要 API Key、Vision 硬编码 Ollama（本机未装），无法跑全链路。

**方案**：`scripts/mock-brain-server.ts` —— 本地"大脑"替身，零侵入拦截 LLM 流量。
原理：Planner 与 Vision 的真实代码路径都是 fetch → baseUrl，把 baseUrl 指向本地即可测真实产品代码，不改一行生产代码。

- **端点**：`POST /v1/chat/completions`（OpenAI 兼容，Planner 消费）+ `POST /api/chat`（Ollama 协议，Vision 消费），端口默认 11434
- **live 模式（以身入局）**：请求落盘 `output/mock-brain/<id>/`（request.json + images/，截图解码为 PNG）→ 阻塞等待 → 外部 AI 用 Read 看 prompt 与截图、Write 写 `response.json {"content":"..."}` 或 `response.txt` 纯文本（免转义，推荐）
- **scripted 模式**：`--script scripts/mock-brain-scripts/demo.json` 按 match 子串返回固定响应，无人值守自动化回归
- **启动**：`npx tsx scripts/mock-brain-server.ts --mode scripted --script scripts/mock-brain-scripts/demo.json`
  - Planner 接入：`OPENOXYGEN_PLANNER_BASE_URL=http://localhost:11434/v1` + `OPENOXYGEN_PLANNER_API_KEY=mock`
  - Vision 零配置（硬编码 localhost:11434）
- **注意**：服务器占用 11434 端口；将来装真 Ollama 前先停掉它

**已验证**（2026-08-22）：
1. ✅ Planner 全链路：live 模式下外部大脑生成 7 步计划 JSON → JSON 提取/步骤校验/依赖图全部通过
2. ✅ Vision 两分支：截图 base64 解码落盘 → 外部大脑读图作答；`found:false` 正确返回 null，`found:true` bounds 坐标正确解析
3. ✅ Scripted 回归：规则命中返回固定计划，结构断言通过（~100ms）
4. ✅ 测试脚本：`scripts/test-planner-mock.ts`、`scripts/test-vision-mock.ts`

**附带修复**：node_modules 迁移后损坏（jest-cli/build 空、fast-glob out/ 缺失）→ 删 node_modules 重装解决；补装 fs/manager.ts 缺失声明的 fast-glob/chokidar/archiver/unzipper。修复后 tsc 0 错误、jest 15/15 通过。
