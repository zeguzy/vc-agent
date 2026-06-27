## MODIFIED Requirements

### Requirement: 创建 Pi SDK Agent 会话
系统 SHALL 调用 Pi SDK 的 `createAgentSessionRuntime()` 创建一个 `AgentSessionRuntime` 承载当前会话；runtime 内部的 factory SHALL 调用 `createAgentSession()` 配置内置工具（read、bash、edit、write），并使用纯内存 API（`AuthStorage.inMemory()`、`ModelRegistry.inMemory(authStorage)`、`SettingsManager.inMemory()`）创建 auth / model / settings 附属组件，不读取 Pi 磁盘配置；`SessionManager` SHALL 根据启动恢复意图选择模式（新建持久化 / continueRecent / open），不再固定 `inMemory()`。

#### Scenario: 成功创建 runtime
- **WHEN** 系统启动且检测到有效的 LLM API Key（如 `ANTHROPIC_API_KEY`）或 openagent config.json 中配置了 provider API key
- **THEN** 根据启动模式构造 `SessionManager`：new → `SessionManager.create(cwd, sessionDir)`；continue → `SessionManager.continueRecent(cwd, sessionDir)`；resume/session → `SessionManager.list` 匹配 id/path 后 `open`（详见 session-persistence 规格）
- **AND** 定义 runtime factory：接收 `{cwd, agentDir, sessionManager}`，内部用 `AuthStorage.inMemory()` / `ModelRegistry.inMemory(authStorage)` / `SettingsManager.inMemory(...)` 创建附属组件（不读取 Pi auth.json/models.json/settings.json），注入 `config.providers[name].apiKey`，初始化 SkillManager/McpManager，调用 `createAgentSession({cwd, model, tools, settingsManager, authStorage, modelRegistry, sessionManager})`
- **AND** 调用 `createAgentSessionRuntime(factory, {cwd, agentDir, sessionManager})` 返回 `runtime`，SDK 自动检测并恢复历史上下文（若 sessionManager 含历史数据）
- **AND** `createRuntime` 返回 `runtime`（而非裸 `session`），调用方（`index.tsx` / App）通过 `runtime.session` 访问当前会话

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

## ADDED Requirements

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
