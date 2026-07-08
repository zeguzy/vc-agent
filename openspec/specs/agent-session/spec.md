# agent-session Specification

## Purpose
定义 Agent 会话的创建过程，包括 Provider 注册、Model 解析、Skill 自动发现和 ResourceLoader 配置。
## Requirements
### Requirement: Skill 自动发现
系统 SHALL 在创建 Agent 会话时自动扫描并加载技能（Skills），将可自动调用的技能注入到系统提示中。系统提示 SHALL 由基础 prompt 和上下文文件内容组装而成（详见 context-files 规格），不再使用硬编码字符串。

#### Scenario: 全局技能扫描
- **WHEN** 系统启动
- **THEN** 创建 `DefaultResourceLoader`，配置 `agentDir=~/.config/openagent`
- **AND** 自动扫描 `~/.config/openagent/skills/` 目录下的 SKILL.md 文件
- **AND** systemPrompt 由 `loadSystemContext(cwd, config)` 生成，非硬编码

#### Scenario: 项目技能扫描
- **WHEN** 系统启动
- **THEN** 自动扫描 `<cwd>/.openagent/skills/` 目录下的 SKILL.md 文件

#### Scenario: 额外技能路径
- **WHEN** `config.skills.paths` 配置了额外的路径
- **THEN** 这些路径 SHALL 被加入 `additionalSkillPaths` 传入 `DefaultResourceLoader`

#### Scenario: 禁用自动加载
- **WHEN** `config.skills.autoLoad` 为 `false`
- **THEN** 系统 SHALL 不扫描默认技能目录（但额外路径仍可配置）

#### Scenario: 排除特定技能
- **WHEN** `config.skills.disabled` 列出了技能名称
- **THEN** 这些技能 SHALL 通过 `skillsOverride` 从加载结果中过滤掉

#### Scenario: 上下文文件注入 system prompt
- **WHEN** 系统启动并初始化 SkillManager
- **THEN** systemPrompt SHALL 调用 `loadSystemContext(cwd, config)` 生成
- **AND** 结果包含 base prompt + 全局 rules + 项目 rules + instructions 文件

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

### Requirement: Pi 事件流映射为 React State
系统 SHALL 订阅 Pi SDK 的事件系统，将 Agent 生命周期事件映射为 React state 更新，驱动 OpenTUI 组件重新渲染。

#### Scenario: 流式文本输出
- **WHEN** 收到 `message_update` 事件且包含 `text_delta`
- **THEN** 将文本增量追加到当前 Agent 消息的 state，触发 MessageList 组件重新渲染

#### Scenario: 工具调用开始
- **WHEN** 收到 `tool_execution_start` 事件
- **THEN** 在消息 state 中添加工具调用消息（`{ type: "tool", name, args, status: "running" }`）

#### Scenario: 工具调用完成
- **WHEN** 收到 `tool_execution_end` 事件
- **THEN** 更新对应工具消息的 status 为 "done"，记录结果摘要

#### Scenario: Agent 回合结束
- **WHEN** 收到 `agent_end` 事件
- **THEN** 设置 `isRunning` state 为 false，恢复输入框交互

### Requirement: 发送用户输入到 Agent
系统 SHALL 通过 `session.prompt(text)` 将用户输入发送到 Agent，触发新一轮 Agent 循环。

#### Scenario: 提交用户输入
- **WHEN** 用户在输入行按 Enter 键
- **THEN** 系统调用 `session.prompt(inputText)`，等待 Agent 响应期间禁用输入

### Requirement: TUI 内运行时会话热切换
系统 SHALL 通过 `AgentSessionRuntime` 支持 TUI 内不重启进程切换会话：`/sessions` 列表选中、`/resume`、`/new` 调用 `runtime.switchSession(path)` / `runtime.newSession()`，SDK 内部完成旧会话 teardown + 新会话创建；App SHALL 通过 `runtime.setRebindSession` 注册重绑钩子响应切换。

#### Scenario: 切换到指定会话
- **WHEN** 用户在 `/sessions` 列表选中某会话，或执行 `/resume <id>`
- **THEN** 系统 SHALL 调用 `runtime.switchSession(<对应 path>)`
- **AND** SDK SHALL teardown 当前 runtime、用 factory 创建新 runtime、恢复历史上下文
- **AND** SDK SHALL 触发 `setRebindSession` 注册的回调，传入新 `AgentSession`

#### Scenario: 新建会话
- **WHEN** 用户执行 `/new`
- **THEN** 系统 SHALL 调用 `runtime.newSession()`
- **AND** SDK SHALL 创建新的持久化会话（写入新 JSONL 文件）并触发 rebind 回调

#### Scenario: rebind 钩子重绑 UI
- **WHEN** `setRebindSession` 回调被触发，收到新 session
- **THEN** App SHALL `setSession(newSession)` 更新当前会话 state
- **AND** SHALL 用 `mapSdkMessagesToTui(newSession.messages)` 重新设置 `messages` state（渲染新会话历史）
- **AND** SHALL 重置滚动到底部、运行状态为空闲
- **AND** 现有 `useEffect([session])` 的事件订阅 SHALL 因 session 引用变化自动 unsubscribe 旧会话订阅、subscribe 新会话订阅

#### Scenario: 切换被取消
- **WHEN** `switchSession` / `newSession` 返回 `{ cancelled: true }`（如被 `session_before_switch` 事件取消）
- **THEN** 系统 SHALL 保持当前会话不变，不触发 rebind

#### Scenario: 切换失败
- **WHEN** `switchSession` / `newSession` 抛出错误（如目标会话文件无效）
- **THEN** 系统 SHALL 在 TUI 显示错误消息，保持当前会话不变

### Requirement: 恢复会话的历史消息渲染
系统 SHALL 在恢复会话或热切换后，把 SDK `buildSessionContext()` 重建出的历史 messages 映射为 TUI 的 `Message[]`，作为 App 当前 `messages` state 渲染。

#### Scenario: 映射 user 消息
- **WHEN** 历史含 role 为 user 的消息
- **THEN** 系统 SHALL 通过 `createUserMessage(text)` 映射

#### Scenario: 映射 assistant 消息（含 thinking）
- **WHEN** 历史含 role 为 assistant 的消息
- **THEN** 系统 SHALL 通过 `extractAssistantContent` 提取 text 与 thinking，映射为 `createAssistantMessage(text)`（thinking 非空则附加）

#### Scenario: 映射 tool 调用为摘要
- **WHEN** 历史含 tool_use 内容
- **THEN** 系统 SHALL 映射为 `createToolMessage(name, args, "done")` 摘要（MVP 不还原完整 tool_result）

#### Scenario: 回合间分隔符
- **WHEN** 渲染历史消息
- **THEN** 系统 SHALL 在相邻 agent 回合之间插入 `createSeparator()`

#### Scenario: 未知内容降级
- **WHEN** 历史消息含无法识别的内容块类型
- **THEN** 系统 SHALL 降级为纯文本兜底渲染，不崩溃

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

### Requirement: Agent 定义 frontmatter 扩展字段

系统 SHALL 在 `src/agents/discover.ts:loadAgentsFromDir` 与 `src/agents/types.ts:AgentDefinition` 解析以下 frontmatter 字段为可选：`disallowedTools?: string[]` / `maxTurns?: number` / `background?: boolean` / `permissionMode?: "default" | "plan" | "acceptEdits"` / `tier?: "fast" | "standard" | "powerful"`（V1 不允许 `"bypass"`，校验失败跳过 agent 并 warn——详见下方 Scenario `permissionMode 枚举拒收 bypass`）。未声明时分别采用：`[]` / `Config.teams.defaultMaxTurns`（默认 8）/ `false` / `"default"` / `undefined`。

#### Scenario: 解析 disallowedTools 字段
- **WHEN** agent frontmatter 含 `disallowedTools: [write, edit]`
- **THEN** `AgentDefinition.disallowedTools` SHALL 为 `["write", "edit"]`
- **AND** 后续 `runSubagent` 与 `WorkerSessionPool.spawnWorker` SHALL 在应用 `tools` allowlist 之前先从工具集中移除上述工具

#### Scenario: 解析 maxTurns 字段
- **WHEN** agent frontmatter 含 `maxTurns: 20`
- **THEN** `AgentDefinition.maxTurns` SHALL 为 `20`
- **AND** 用作 worker 时 SHALL 覆盖 `Config.teams.defaultMaxTurns`；作为同步 subagent 时 SHALL 与现有 `chain` / `parallel` 模式无关（同步 subagent 仍受 SDK 默认限制）

#### Scenario: 解析 background 字段
- **WHEN** agent frontmatter 含 `background: true`
- **THEN** `AgentDefinition.background` SHALL 为 `true`
- **AND** 该 agent 才能被 `team.spawn` 工具或 `/team spawn` 命令作为异步 worker spawn
- **AND** `background: false` 或未声明的 agent 被 `team.spawn` 时 SHALL 返回 isError：`"agent <name> is not background-capable"`

#### Scenario: 解析 permissionMode 字段
- **WHEN** agent frontmatter 含 `permissionMode: plan`
- **THEN** SHALL 强制 worker / subagent 只读：所有 `write`/`edit`/`bash` 的可能修改路径 SHALL 被禁用
- **AND** 等价运行时只激活 `STANDARD_ACTIVE_TOOLS` 减去 `["write", "edit", "bash"]` 的子集

#### Scenario: 未声明字段保留默认
- **WHEN** agent frontmatter 未声明任何上述五个字段
- **THEN** `AgentDefinition.disallowedTools = []`、`maxTurns = Config.teams.defaultMaxTurns`（默认 8）、`background = false`、`permissionMode = "default"`、`tier = undefined`
- **AND** 现有 agent 定义文件**无需改写**，零迁移成本

#### Scenario: permissionMode 枚举拒收 bypass
- **WHEN** agent frontmatter 含 `permissionMode: bypass` 或不属于 `"default" | "plan" | "acceptEdits"` 的其他取值
- **THEN** `src/agents/discover.ts` YAML 解析 SHALL 视为非法、跳过该 agent 并 stderr 输出 warn `agent <name> permissionMode must be one of default|plan|acceptEdits, got "<value>"`
- **AND** V1 不允许 `bypass` 取值的约束 SHALL 在 `discover.ts` 枚举校验处强制；`bypass` 留待 V2 提案独立设计权限模型时再评估其必要性

#### Scenario: tier 枚举校验
- **WHEN** agent frontmatter 含 `tier: ultra` 或不属于 `"fast" | "standard" | "powerful"` 的其他取值
- **THEN** `src/agents/discover.ts` YAML 解析 SHALL 视为非法、跳过该 agent 并 stderr 输出 warn `agent <name> tier must be one of fast|standard|powerful, got "<value>"`

### Requirement: Worker session 创建路径（异步起点）

系统 SHALL 在 `src/teams/worker.ts` 提供 `Worker.spawn(opts)` 静态工厂，**先直接在 worker.ts 内创建独立 `createAgentSession`**（不立刻抽出 `src/agents/runner.ts:runSubagent` 共享工厂），关键改造是把 `session.prompt(task)` 改成 fire-and-track 而非 await。事后通过 tasks 14.2 重构 `runSubagent` 与 `Worker.spawn` 共享工厂。

模型解析 SHALL 调用统一函数 `resolveSubagentModel({agent, config, modelRegistry, parentModel})`（定义于 `src/agents/model-resolver.ts`），该函数按链式回退优先级解析模型，返回 `ResolvedModel | undefined`。返回 `undefined` 时 SHALL throw Error。

#### Scenario: spawn 不阻塞主 agent 工具调用
- **WHEN** `Worker.spawn({agent, task, cwd, services, parentModel, signal?})` 被调用
- **THEN** SHALL 内部 `createAgentSession` 创建独立会话，配置：
  - `cwd`（与主 session 同一）
  - `authStorage` / `modelRegistry` / `settingsManager` 复用主会话的 `services`
  - `model`: `resolveSubagentModel({agent, config: services.config, modelRegistry: services.modelRegistry, parentModel})` 的返回值，为 undefined 时 throw
  - `tools`: 解析 `agent.tools` allowlist（应用 `disallowedTools` deny 后再应用 `tools` 允许）
  - `resourceLoader`: `new DefaultResourceLoader({cwd, agentDir, settingsManager, appendSystemPrompt: [agent.systemPrompt], noSkills: true, noContextFiles: true, noExtensions: true})`
- **AND** SHALL 注册 `session.subscribe()` 转发事件到 `WorkerSessionPool`
- **AND** SHALL **不 await** `session.prompt(task)`；调用方法立即返回 Worker 实例
- **AND** prompt 的 promise 异步 settle 时（done / error / cancelled）SHALL 更新 worker.status 并 emit 对应 kind 事件

#### Scenario: worker 默认禁用 write/edit
- **WHEN** agent frontmatter 未显式声明允许 `edit` 或 `write` 工具
- **THEN** 实际激活工具集 SHALL 从 `agent.tools ?? BUILTIN_TOOLS` 中过滤掉 `["write", "edit"]`
- **AND** 同步 subagent `runSubagent` 调用路径 SHALL 与现有行为保持一致（不引入回退）

#### Scenario: worker 模型解析使用统一链式回退
- **WHEN** worker 构造时需要解析模型
- **THEN** SHALL 调用 `resolveSubagentModel({agent, config, modelRegistry, parentModel, extraFallback: defaultWorkerModel})`
- **AND** 解析链 SHALL 为：`config.subagents.models[agent.name]` > `config.subagents.modelTiers[agent.tier]` > `parentModel` > `agent.model`（经 resolveModel） > `extraFallback`/`defaultWorkerModel`（经 resolveModel） > `config.subagents.fallback`（经 resolveModel） > `config.model`（经 resolveModel） > throw
- **AND** parentModel（③）优先于 agent.model（④），因为 agent.model 字符串经 resolveModel 可能误匹配到错误 provider
- **AND** 全部候选均失败时 SHALL throw Error，消息包含 agent name 和已尝试的候选列表

#### Scenario: worker 单点失败不传染 pool
- **WHEN** 某 worker 的 prompt promise reject（如 LLM 限流 / 网络 drop / API timeout）
- **THEN** `Worker.run()` 的 `try { await session.prompt(task) } catch (e) { ... }` 路径 SHALL 是唯一 error 转换点
- **AND** worker.status 置为 `error`、`lastError` 记录 `error.message`（兜底为 `error.toString()`）
- **AND** SHALL emit `kind: "error"` 事件，payload `{reason: "prompt_rejected", message: <error.message>}`
- **AND** `WorkerSessionPool` 中其他 worker SHALL 不受影响

#### Scenario: worker 不共享主 session 的 EditConfirmBridge
- **WHEN** agent frontmatter `permissionMode: "acceptEdits"` 且 `tools` 显式声明包含 `edit` 或 `write`
- **THEN** worker 的 `createAgentSession` SHALL 注入 SDK 内置 `edit` / `write` 工具（不通过 `createEditTool`/`editBridge` 包装），底层 fsWriteFile 直写不弹确认 UI
- **AND** worker SHALL NOT 持有对主 session `runtime.factory` 闭包内 `editBridge` / `QuestionBridge` 的任何引用
- **AND** 与现有 headless 模式行为对齐（无 TUI 时主 session 也是直写路径）

#### Scenario: worker 不注入 question 工具
- **WHEN** worker 构造 active tools 时遍历候选工具名
- **THEN** `question` SHALL NOT 出现在 worker 激活工具列表中（即便 agent frontmatter `tools` 数组显式列了 `question`，也 SHALL 被强制过滤）
- **AND** 若 worker LLM 因任何路径调用 question：worker SHALL 返回 `isError: true` 工具结果 `Error("question tool unavailable in worker context")`，主 agent 在 `team.poll` 中能识别该 error
- **AND** 此约束 SHALL 实现于 `src/teams/worker.ts` worker active tools 构造点

#### Scenario: worker 不注入 LSP 工具避免并发压力
- **WHEN** worker 构造 active tools 时遍历候选工具名
- **THEN** `lsp_diagnostics` / `lsp_goto_definition` / `lsp_find_references` SHALL NOT 出现在 worker 激活工具列表中（即便 agent frontmatter `tools` 数组显式列了这些名字）
- **AND** worker 不创建独立 `LspClient` 实例，也不持主 session `LspClient` 引用
- **AND** 此约束 SHALL 实现于 `src/teams/worker.ts`，并在 frontmatter `tools` 含 LSP 工具名时 stderr 输出 warn `agent <name> claims lsp tools but workers do not support them in V1`

#### Scenario: worker 不允许嵌套 team 调用
- **WHEN** worker LLM 调用 `team` 工具（任何 action）
- **THEN** `team` 工具 SHALL 检测调用栈是否处于 worker session（通过 `WorkerPoolRef.current` 与当前 session id 比对）
- **AND** 在 worker 上下文中 SHALL 返回 `isError: true` 工具结果 `nested team calls are forbidden`，主 agent 在 `team.poll` 时识别该 worker stuck on forbidden action 并取消

### Requirement: 主 session 切换时 worker 生命周期

系统 SHALL 在 `AgentServer.abendHandler` 处理主 session 切换钩子时检查 worker pool 生命周期。`Config.teams.cancelOrphansOnSessionChange` 默认 `true`：主 session `switchSession` / `newSession` 触发时自动 `workerPool.cancelAll()` 并 emit `team_orphans_cancelled`；显式设为 `false` 时 worker 跨主 session 保持运行（但 worker 与新主 session 上下文孤绝，需用户自行 `team.poll` 闭合）。

#### Scenario: 主 session 切换默认取消 running worker
- **WHEN** 主 agent 调用 `runtime.switchSession(path)` 或 `runtime.newSession()` 触发 SDK `setRebindSession` 回调
- **AND** `Config.teams.cancelOrphansOnSessionChange !== false`（默认 true）
- **THEN** `AgentServer` SHALL 在 rebind 钩子内同步调 `workerPool.cancelAll()`
- **AND** SHALL emit `team_orphans_cancelled` 事件，payload `workerIds: [取消的 worker id 列表]`
- **AND** TUI SHALL 在新 session 主消息流末显示提示行 `[N orphan workers cancelled due to session change]`

#### Scenario: 主 session 切换保留 running worker
- **WHEN** `Config.teams.cancelOrphansOnSessionChange === false`
- **THEN** SHALL 不自动 cancelAll，worker 在新主 session 上下文中继续后台执行
- **AND** 进程退出钩子 SHALL 仍保证 `workerPool.disposeAll()` 在 `process.on("exit")` 触发
- **AND** TUI SHALL 在新 session StatusBar 显示提示 `teams: N orphan worker(s) still running in old session context`

### Requirement: 启动初始化并行与 UI 异步化

系统 SHALL 在启动期最大化并行化服务初始化，并将阻塞事件循环的 UI 层操作改为异步，以降低首帧可感知延迟。

#### Scenario: initServices 三服务并行初始化

- **WHEN** `initServices(opts)` 被调用（createRuntime 或 createSession 路径）
- **THEN** SkillManager.initialize、LspClient.init、McpManager.initialize SHALL 通过 `Promise.all` 并行执行
- **AND** 三者的输入仅来自 `opts`（cwd/config/settingsManager/appendSystemPrompt），无互相依赖
- **AND** 总耗时 SHALL 约等于三者中耗时最长者（max(A,B,C)），而非三者之和
- **AND** 若任一 throw（如 SkillManager 文件读取失败），整体 SHALL reject 并中断启动（合理失败语义）

#### Scenario: PollManager 支持异步 fetch

- **WHEN** `PollManager.register(key, fetch, intervalMs)` 的 `fetch` 返回 `Promise<T>`
- **THEN** `run()` SHALL `await fetch()`，兼容同步和异步返回值
- **AND** 同步 fetch（返回 T）SHALL 仍正常工作（`await syncValue` 为 no-op）
- **AND** `run()` SHALL fire-and-forget 调用（不阻塞 setInterval 调度）
- **AND** PollTask SHALL 持有 `running: boolean` 标志，防止慢 fetch 期间重入

#### Scenario: git-dirty 异步获取不阻塞事件循环

- **WHEN** App.tsx `useEffect` 注册 `pollManager.register("git-dirty", () => getGitDirty(cwd), 3000)`
- **THEN** `getGitDirty` SHALL 使用 `execFile`+`promisify`（非阻塞）替代 `execSync`（阻塞）
- **AND** 首次 `run()` SHALL 立即返回（不等待 git 进程），事件循环保持响应
- **AND** git 进程完成后 SHALL 通过 subscriber 回调更新状态栏
- **AND** `getGitBranch`（读 `.git/HEAD`）SHALL 保持同步（<1ms，无需异步化）

#### Scenario: loadHistory 异步加载不阻塞首帧

- **WHEN** App 组件首次渲染
- **THEN** `history` state SHALL 初始为空数组（`useState<HistoryEntry[]>([])`）
- **AND** `loadHistory` SHALL 在 `useEffect` 中异步执行，完成后 `setHistory` 触发重渲染
- **AND** 首帧渲染 SHALL 不等待历史文件读取
- **AND** 历史加载完成前用户按上键调历史 SHALL 无操作（不崩溃），加载完后自动可用

### Requirement: question 工具注册
系统 SHALL 在创建 Agent 会话时，将 `createQuestionTool(bridge)` 注册到 `customTools` 数组中，与 LSP 工具和 todo 工具并列。bridge 对象 SHALL 通过 `createRuntime` 的参数传入，传递到 runtime factory 内部。

#### Scenario: createRuntime 接收 bridge
- **WHEN** 调用 `createRuntime({cwd, model, config, mode, agentMode, sessionRef, name, bridge})`
- **THEN** runtime factory SHALL 调用 `createQuestionTool(bridge)` 并将返回的 ToolDefinition 加入 `customTools` 数组

#### Scenario: createSession（legacy）接收 bridge
- **WHEN** 调用 `createSession({...bridge})`（in-memory 模式）
- **THEN** SHALL 同样注册 `createQuestionTool(bridge)` 到 customTools

#### Scenario: bridge 未传入时降级
- **WHEN** bridge 参数为 undefined（如 headless/HTTP 模式）
- **THEN** `createQuestionTool(undefined)` SHALL 返回一个工具定义，其 execute() 检测到 bridge 不可用时立即返回错误结果，不阻塞

