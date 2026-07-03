## MODIFIED Requirements

### Requirement: 创建 Pi SDK Agent 会话
系统 SHALL 调用 Pi SDK 的 `createAgentSessionRuntime()` 创建一个 `AgentSessionRuntime` 承载当前会话；runtime 内部的 factory SHALL 调用 `createAgentSession()` 配置内置工具（read、bash、write、grep、find）和自定义工具（edit、LSP 三件套、todo、question、notify、webfetch、subagent），并使用纯内存 API（`AuthStorage.inMemory()`、`ModelRegistry.inMemory(authStorage)`、`SettingsManager.inMemory()`）创建 auth / model / settings 附属组件，不读取 Pi 磁盘配置；`SessionManager` SHALL 根据启动恢复意图选择模式（新建持久化 / continueRecent / open），不再固定 `inMemory()`。

注：edit 工具从 Pi SDK 内置改为 vc-agent 自定义（`createEditTool`），以支持编辑前 diff 预览 + 用户确认（详见"工具调用确认（edit）"Requirement）。edit 不再出现在 `BUILTIN_TOOLS` 中。

#### Scenario: 成功创建 runtime
- **WHEN** 系统启动且检测到有效的 LLM API Key（如 `ANTHROPIC_API_KEY`）或 openagent config.json 中配置了 provider API key
- **THEN** 根据启动模式构造 `SessionManager`：new → `SessionManager.create(cwd, sessionDir)`；continue → `SessionManager.continueRecent(cwd, sessionDir)`；resume/session → `SessionManager.list` 匹配 id/path 后 `open`（详见 session-persistence 规格）
- **AND** 定义 runtime factory：接收 `{cwd, agentDir, sessionManager, editBridge}`，内部用 `AuthStorage.inMemory()` / `ModelRegistry.inMemory(authStorage)` / `SettingsManager.inMemory(...)` 创建附属组件（不读取 Pi auth.json/models.json/settings.json），注入 `config.providers[name].apiKey`，初始化 SkillManager 和 LspClient，调用 `createAgentSession({cwd, model, tools, customTools, settingsManager, authStorage, modelRegistry, sessionManager})`
- **AND** `tools` SHALL 为 `["read","bash","write","grep","find"]`（不再含 `"edit"`）
- **AND** `customTools` SHALL 包含 `createEditTool(cwd, editBridge)` 产出的 edit ToolDefinition（参数 schema `{path, edits:[{oldText,newText}]}` 对齐 LLM 期望），以及 LSP 三件套、todo、question、notify、webfetch、subagent
- **AND** 调用 `createAgentSessionRuntime(factory, {cwd, agentDir, sessionManager})` 返回 `runtime`，SDK 自动检测并恢复历史上下文（若 sessionManager 含历史数据）
- **AND** `createRuntime` 返回 `runtime`，调用方通过 `runtime.session` 访问当前会话

#### Scenario: LSP 自定义工具注入
- **WHEN** runtime factory 创建 Agent 会话
- **THEN** `customTools` 参数 SHALL 包含由 LspClient 生成的三个 ToolDefinition（lsp_diagnostics、lsp_goto_definition、lsp_find_references）
- **AND** 若 LspClient 初始化失败，customTools 的 LSP 部分为空数组，不影响 edit 等其他工具

#### Scenario: 缺少 API Key
- **WHEN** 系统启动但未检测到任何 LLM API Key（环境变量及 config.providers 均无）
- **THEN** 显示错误消息（"请设置 ANTHROPIC_API_KEY 或 OPENAI_API_KEY"），然后退出

#### Scenario: SDK 句柄链式访问
- **WHEN** settings 模块或命令需要调用 SDK 句柄
- **THEN** SHALL 通过 `runtime.session.settingsManager`、`runtime.session.modelRegistry`、`runtime.session.modelRegistry.authStorage`、`runtime.session.sessionManager` 链式访问

#### Scenario: Pi 配置不被读取
- **WHEN** 系统启动创建 runtime
- **THEN** SHALL NOT 访问 `~/.pi/agent/` 目录下的任何文件
- **AND** 即使 `~/.pi/agent/` 目录存在，其内容 SHALL NOT 影响会话创建

#### Scenario: Pi settings.json 不被写入
- **WHEN** `Setting.apply` 调用 Pi setter
- **THEN** 因 `SettingsManager` 为 inMemory 实例，SHALL 仅改内存，不触发 Pi 写 `~/.pi/agent/settings.json`

#### Scenario: 会话数据不写入 pi 目录
- **WHEN** 系统创建或恢复会话
- **THEN** `SessionManager` 的 `sessionDir` SHALL 指向 `~/.config/openagent/sessions/`，会话 JSONL 文件 SHALL NOT 写入 `~/.pi/agent/sessions/`

#### Scenario: 会话切换清理 pending edit 确认
- **WHEN** runtime 执行会话切换（`switchSession` / `newSession`）或 rebind
- **THEN** 系统 SHALL 调用 `clearEditConfirmBridge(editBridge)` reject 任何 pending 的 edit 确认 Promise 并清空 bridge，避免切换后旧确认悬挂
- **AND** 此清理 SHALL 与 `clearBridge(questionBridge)` 在同一位置联动执行

## ADDED Requirements

### Requirement: 工具调用确认（edit）
系统 SHALL 在 edit 工具写盘前，通过 `EditConfirmBridge` 向用户展示 unified diff 预览并等待确认；用户可选择 Allow（执行写盘）或 Reject（带可选反馈文本回喂 agent）。非交互模式（无 bridge）SHALL 降级为直写不阻塞。

#### Scenario: edit 工具拦截 writeFile 等待确认（拦截器方案）
- **WHEN** LLM 调用 edit 工具且 `EditConfirmBridge` 存在（TUI 模式）
- **THEN** `createEditTool` SHALL 用 SDK 公开的 `createEditToolDefinition(cwd, { operations: customOps })` 创建工具，customOps.writeFile 是拦截器
- **AND** SDK execute（复用，不自研）SHALL 完成 access/readFile/匹配/应用后调用 `ops.writeFile(absolutePath, finalContent)`
- **AND** customOps.writeFile SHALL 读取旧内容（`fsReadFile`）、用 SDK 公开的 `generateUnifiedPatch(absolutePath, oldContent, newContent)` 算 unified diff 文本（`patch`）
- **AND** customOps.writeFile SHALL 将 `{filePath, patch}` 存入 `editBridge.pending`，保存 Promise 的 resolve/reject 回调，`await` 该 Promise（writeFile 在此阻塞，SDK execute 随之阻塞）
- **AND** customOps.writeFile SHALL 注册 `signal.abort` 监听，abort 时 `clearEditConfirmBridge` + reject

#### Scenario: edit 工具强制 sequential 执行模式（防并行 bridge 冲突）
- **WHEN** LLM 在单个 batch 中发出多个工具调用且其中含 edit
- **THEN** edit ToolDefinition SHALL 设 `executionMode: "sequential"`，SDK SHALL 强制整个 batch 串行执行（pi-agent-core 约定：batch 含 sequential 工具则全 batch 串行）
- **AND** 此约束 SHALL 防止并发 edit 覆盖 `editBridge.pending` 单槽导致死锁（第一个 edit 的 Promise 永不 resolve）

#### Scenario: edit 工具在激活集中可用（防 BUILTIN_TOOLS 移除级联丢失）
- **WHEN** `BUILTIN_TOOLS` 移除 `"edit"` 后构造激活工具集
- **THEN** `STANDARD_ACTIVE_TOOLS` SHALL 显式包含 `"edit"`（不再依赖从 `ALL_TOOLS`/`BUILTIN_TOOLS` 继承，否则会级联丢失）
- **AND** `PLANNER_ACTIVE_TOOLS` SHALL 不含 `"edit"`（planner 只读模式）
- **AND** `activeToolsFor("standard")` SHALL 返回含 "edit" 的集合，确保 SDK `initialActiveToolNames` 激活自定义 edit 工具（customTools 只注册不激活）

#### Scenario: 用户选 Allow once
- **WHEN** DiffConfirmBox 调用 `bridge.resolve({kind:"accept"})`
- **THEN** customOps.writeFile SHALL 恢复执行，调用 `fsWriteFile(absolutePath, newContent, "utf-8")` 真写盘（保留 SDK execute 已恢复的 BOM 与行尾），清空 bridge
- **AND** customWriteFile 返回后，SDK execute SHALL 继续执行（算 diff、返回 `{content:[{type:"text",text:"Successfully replaced N block(s) in <path>."}], details:{patch}}`）

#### Scenario: 用户选 Reject 带反馈
- **WHEN** DiffConfirmBox 调用 `bridge.resolve({kind:"reject", feedback:"<非空文本>"})`
- **THEN** customOps.writeFile SHALL 不写盘，清空 bridge，`throw new Error("<用户反馈文本>")`
- **AND** throw SHALL 经 SDK execute（edit.js:208 writeFile 裸 await 无 try/catch）传播为工具结果 `{isError:true, content:[{type:"text",text:"<用户反馈文本>"}]}`，喂回 LLM 驱动自纠错

#### Scenario: 用户选 Reject 空反馈
- **WHEN** DiffConfirmBox 调用 `bridge.resolve({kind:"reject", feedback:""})` 或在 choose 阶段按 esc
- **THEN** customOps.writeFile SHALL `throw new Error("用户拒绝了 edit 调用")`
- **AND** 传播为 `{isError:true, content:[{type:"text",text:"用户拒绝了 edit 调用"}]}`（通用拒绝）

#### Scenario: SDK 匹配失败（不触发确认）
- **WHEN** SDK execute 的 `applyEditsToNormalizedContent` 因 `oldText` 找不到、多次出现、或 edits 重叠/嵌套而抛错
- **THEN** 该错误 SHALL 在 `ops.writeFile` 调用前抛出，customOps.writeFile 不被调用，确认 UI 不触发
- **AND** 错误 SHALL 经 SDK execute 传播为 `{isError:true, content:[{type:"text",text:"Found N occurrences / not found / ..."}]}`，喂回 LLM 重试

#### Scenario: 目标文件不存在
- **WHEN** edit 的 `path` 指向不存在的文件
- **THEN** SDK execute 的 `ops.access(absolutePath)` SHALL 抛错（edit.js:188-196 try/catch 捕获后 `throw new Error("Could not edit file: <path>. ENOENT...")`）
- **AND** 该错误 SHALL 在 readFile/writeFile 前抛出，不触发确认 UI，传播为 isError 工具结果

#### Scenario: 非交互模式降级直写
- **WHEN** LLM 调用 edit 工具且 `EditConfirmBridge` 为 undefined（headless runner / serve+attach 无 TUI）
- **THEN** customOps.writeFile SHALL 跳过确认步骤，直接 `fsWriteFile(absolutePath, newContent, "utf-8")` 写盘（与 SDK 默认 operations.writeFile 行为一致）
- **AND** SDK execute SHALL 继续，返回 `{content, details:{patch}}`（与 TUI 模式成功路径一致，便于 serve 模式事后查看）

#### Scenario: 会话切换 abort pending 确认
- **WHEN** 会话切换触发 `clearEditConfirmBridge(editBridge)` 且 bridge 有 pending
- **THEN** pending 的 Promise SHALL 被 reject（Error("Edit confirmation cancelled")）
- **AND** customOps.writeFile SHALL 捕获 reject 并 throw，经 SDK execute 传播为 `{isError:true, content:[{type:"text",text:"会话切换取消了 edit 确认"}]}`
