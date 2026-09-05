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

## P0 修复与仓库入库（2026-08-30 续）

**P0 修复全落地**（commit abc2a50，jest 32→36 全过，tsc 0 错误）：
1. `validateStep` 识别 `{success:false}` 动作结果——GUI 失败不再被虚报成功（失败上报链路打通，handleFailure 的智能重试从此真正生效）
2. `checkDependencies` 要求依赖存在**且成功**——失败的依赖不再算满足
3. gui_type 空 text 在计划校验（SimplePlanner）与执行层双重拒绝——no-op 假成功源头关闭
4. `executeStream` 构造最小 context 替代 `null as any`——不再是必崩死路
5. `handleFailure` 用重试成功结果替换 results 数组中的失败项（最终报告/依赖检查终于看到真实结果）；`retryConfig?.maxRetries` 空引用防护
6. **robot.screenshot 真 PNG 编码**（零依赖 zlib 实现，BGRA→RGBA + CRC32）——System.Drawing 独立解码器交叉验证像素精确对应；视觉兜底链路打通的前提补齐
7. SimplePlanner target 告警精确化（键盘型 gui_type 不再误报）

**PNG 编码器位置**：`src/gui/robot.ts::encodeBitmapToPng`（exported），单测 `src/gui/robot-png.test.ts`（签名/IHDR/像素通道/IDAT 解压/IEND 全覆盖）。

**仓库入库（BC 规范）**：
- 远端已迁移：`origin = https://github.com/OxygenAILab/OxygenClaw`（旧 `StarsailsClover/OpenOxygen` 保留为 `upstream`）
- 主版本分支 `v26.0`（BC 规范：Major Version 独立分支），基线 5 个分块提交 + P0 修复 1 个提交，**全部 SSH 签名验证通过**（ed25519）
- main/next/v26.0 三分支已推送；`.claude/`、`.opencode-data/` 等会话目录已加入 .gitignore
- 工作树清零（127 项 → 0）

**遗留待办**（未拍板）：VERSION.txt 旧版本号未对齐、CHANGELOG 滞后、水印追溯、P1 剩余 10 项（condition 恒真、F 键支持、buildDependencyMap 死状态等）、Anthropic/Gemini 的 systemPrompt 行为已在引擎层修复但未做 e2e（mock-brain 不含这两协议的 system 字段解析）。

## v26.0-Alpha 2 发布与 P1 批次（2026-08-31）

**Pre-Release 已发布**：https://github.com/OxygenAILab/OxygenClaw/releases/tag/v26.0-alpha.2
- 版本对齐：package.json `26.0.0-alpha.2`、VERSION.txt 重写为 BC 方案、CHANGELOG 补齐 Alpha 2 条目
- tag `v26.0-alpha.2` SSH 签名（ed25519，Good signature）；Pre-Release 附 dist.zip 构建产物 + 不稳定性声明
- 基准（BC Pre-Release 门槛）：tsc 0、build OK、jest 全过、`scripts/benchmark-release.ts` 功能基准（单进程自起 mock-brain：Planner + 四供应商视觉，服务端 imgs=1 计数 4/4）
- 基准内部用产品 `encodeBitmapToPng` 合成测试图（自包含 + dogfood）

**P1 批次修复**（commit 9f777dd）：
1. 错误分类：'Target is required'/'Cannot resolve target' 等配置错误先于元素定位判断（不再误分类为可重试的 ElementNotFound 白白重试 3 次）
2. 重试按 attempt 取策略——delayMs 递增真正生效；timeoutMs 倍数接通到 executeGuiWaitFor（`params.timeout ?? step.timeoutMs ?? 30000`）
3. memory_retrieve 如实报告 hit/miss（不再硬编码 retrieved:true）
4. condition 步骤快速失败（之前恒真 then 分支 no-op 伪装成功）；死 evaluateCondition 删除
5. planner：JSON.parse 防护 + steps 数组校验；依赖图改用 enrich 后步骤构建；identifyParallelGroups 死循环防护
6. optimizePlan 恒等变换（mergeShortSteps 产出执行器不支持的 'parallel' 且破坏依赖边，实现前停用）
7. 删除孤儿重复文件 src/inference/planner/index.ts（零消费者，携带相同缺陷）
8. robot.ts：`+{TAB}` 剥大括号（与 ^/% 分支一致）；`{F1}-{F12}` 支持（正则 + keyMap）

**关键教训（edit 静默丢失）**：callGemini 的 buildGeminiContents 接线 edit 曾报成功但未落盘——定义和单测都在、调用缺失，靠基准的服务端 imgs 计数才发现。**edit 后必须 grep/read 复核关键接线**；此前"4×imgs=1"报告有误（当时实为 3，gemini 缺图），已修正。jest 多 worker 在低内存（<3GB free）会 OOM（Zone Allocation failed），用 `--runInBand` + 清理残留 node 进程。

**P1 剩余**（低优先级）：shouldContinueAfterFailure 忽略 failureAction、执行器共享可变状态（taskId/isRunning）、多显示器负坐标、robotjs 截图性能（bitmap→PNG 全量编码）。

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

## 仓库归属纠正与流程教训(2026-08-31)

- **仓库归属**:OpenOxygen 代码归 OxygenAILab/OpenOxygen(组织内 2026-03 已存在的上游镜像,main 与本地同源);误建的 OxygenAILab/OxygenClaw 已整库删除,名字留给将来 Electron 方向项目。origin 现指向 OpenOxygen,upstream 保留 StarsailsClover/OpenOxygen。
- **真实 API 视觉全链路通过**(网关上游恢复后复测):引擎文本+视觉双通道经 glm-5.3-flash 实测通过。
- **P1/P2 收尾**:执行器实例级互斥(拒绝并发复用,消除跨运行串数据);this.taskId 字段删除(taskId 沿 context 线程化到定位方法);shouldContinueAfterFailure 尊重 step.failureAction(PlanStep 新增可选字段,注意与 ValidationRule.failureAction 同名不同义);validateCoord 允许负坐标(±10000,多显示器副屏)。
- **流程教训(重要)**:
  1. 严禁用 PowerShell Get-Content/Set-Content/[IO.File]::WriteAllText 重写源文件——PS5.1 把无 BOM UTF-8 按 GBK 误读,整文件中文乱码+BOM+模板字符串反引号被吞(两次事故:executor.ts 可 git 还原;agent-loop.ts 未提交只能靠上下文重建)。
  2. 源文件修改只用 Edit 工具或 Write 工具;文本批处理用 Node 脚本(writeFileSync utf8 无 BOM),CRLF 文件先归一化再匹配多行锚点。
  3. **Edit 工具报成功不等于落盘**:callGemini 接线、FACT.md 两次编辑均静默丢失——关键修改后必须 grep/read 复核,commit 后必须 git show 验证 blob。
  4. 控制台 GBK 显示伪影不代表文件损坏,验编码用 Node readFileSync utf8 查关键字符串。
  5. jest 多 worker 在 <3GB 可用内存会 V8 Zone OOM,用 --runInBand。

## AgentLoop 主路径落地(2026-08-31 续)

**架构转向(泽川明确要求)**:自然语言 → LLM 自主决定工具与动作(感知-决策-行动闭环),不再是"一次性脚本生成→盲执行"。SimplePlanner→PlanExecutor 降级为可选批处理模式。

**新增 src/orchestrator/agent-loop.ts**(commit bf107a9):
- 工具集 9 个:screenshot / uia_locate / click / type / key / scroll / cli / wait / finish;按可用能力裁剪 schema
- 观察回环:截图作为带图 user 消息回填(OpenAI tool 消息不带图);UIA/CLI 输出作为 tool 消息回填
- 防护:同一动作连续 3 次执行前拦截;连续两轮纯文本视为文字收尾;maxSteps 上限;瞬态错误退避重试
- 历史瘦身:新截图入库前旧图替换为占位,防多轮累积超网关限制

**引擎四 provider 工具支持**:InferenceRequest.tools(OpenAI 规范形);openai/ollama 透传、anthropic→input_schema、gemini→functionDeclarations;buildOpenAIMessages 映射 assistant.tool_calls + tool 消息(tool_call_id);callOllama 解析响应 tool_calls。anthropic/gemini 响应侧 tool_use 解析未做(按需补)。

**网关关键发现(实测阈值)**:api.ldwnb666.xyz(NewAPI)对请求体 >~100KB 确定性 403 upstream_unavailable(96KB=200,128KB=403,5 连挂非抽奖);此前"间歇 403"全是大载荷轮次。对策已内置:截图 2x 降采样(1024 宽,~30KB,encodeBitmapToPng 第 5 参)+ 历史瘦身。泽川侧可选项:调网关上游 body 上限后可恢复全尺寸截图。

**真实验证**:glm-5.3-flash 经 NewAPI 走 AgentLoop 2 步完成冒烟——真实截图、亲眼读出屏幕上的 OpenCode 窗口标题、cli echo 验证、finish 总结。jest 43/43(+6 AgentLoop 场景),tsc 0。

**CLI 一等入口**(Alpha 3 首块):openoxygen agent "目标" —— AgentLoop 经 commander 暴露,--no-gui/--no-cli/--max-steps/--temperature/--cli-timeout;robotjs 懒加载(纯 CLI 任务不加载原生模块);createConfig provider 按 baseURL 智能推断(修复远程 URL 默认 ollama 必 404 的老 bug,全部命令受益);.env PLANNER 变量纳入通用回退链。真实冒烟 --no-gui 2 步通过。