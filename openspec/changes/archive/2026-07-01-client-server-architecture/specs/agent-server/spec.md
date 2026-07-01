## ADDED Requirements

### Requirement: AgentServer as core engine facade

系统 SHALL 定义 `AgentServer` 作为核心引擎的封装层（facade）。`AgentServer` MUST 组合现有模块（`AgentSessionRuntime`, `SessionManager`, `SkillManager`, `CommandRegistry`, `PollManager`, `LspClient`），不修改它们的内部实现逻辑。

#### Scenario: Server initialization

- **WHEN** 应用启动并创建 `AgentServer` 实例
- **THEN** Server 初始化 `AgentSessionRuntime`、`SessionManager`、`SkillManager`、`CommandRegistry`、`PollManager`、`LspClient`，设置事件转发管道，进入就绪状态

#### Scenario: Existing modules unchanged

- **WHEN** `AgentServer` 被创建
- **THEN** `AgentSessionRuntime`、`SessionManager` 等模块的内部代码未被修改，Server 通过组合（而非继承/重写）方式使用它们

### Requirement: Request handling methods

`AgentServer` SHALL 暴露与 `AgentClient` 接口对应的 request handler 方法。每个 handler 方法 MUST 将请求委托给组合的内部模块。

Handler 方法包括：`handlePrompt(text)`, `handleFollowUp(text)`, `handleAbort()`, `handleListSessions()`, `handleSwitchSession(id)`, `handleNewSession(mode)`, `handleSetSessionName(name)`, `handleGetContextUsage()`, `handleGetAgentMode()`, `handleSetAgentMode(mode)`, `handleExecuteCommand(name, args)`。

#### Scenario: Prompt delegation

- **WHEN** `server.handlePrompt("hello")` 被调用
- **THEN** Server 调用 `runtime.session.prompt("hello")`，Pi SDK agent loop 开始执行

#### Scenario: Session switch delegation

- **WHEN** `server.handleSwitchSession("session-123")` 被调用
- **THEN** Server 调用 `runtime.switchSession("session-123")`，切换到指定 session，后续事件来自新 session

### Requirement: Event forwarding via EventEmitter

`AgentServer` SHALL 通过 EventEmitter 模式转发 Pi SDK 事件。Server MUST 订阅 `session.subscribe()` 的全部事件类型，并将它们 emit 为统一的 `{ type, data }` 格式。

#### Scenario: Event passthrough

- **WHEN** Pi SDK 产生任意事件（如 `message_update`）
- **THEN** Server 的 EventEmitter emit 对应事件，所有通过 `subscribe()` 注册的 handler 收到该事件

#### Scenario: Multiple subscribers

- **WHEN** 多个 handler 通过 `server.subscribe()` 注册
- **THEN** 所有 handler 都收到同一个事件的副本（本地模式下为同一对象引用）

### Requirement: PollManager integration

`AgentServer` SHALL 封装 `PollManager` 的订阅能力。Server MUST 通过 `subscribePoll(key, handler)` 方法转发 poll 订阅请求。

#### Scenario: Git status polling

- **WHEN** Client 调用 `server.subscribePoll("git-branch", handler)`
- **THEN** Server 调用 `pollManager.subscribe("git-branch", handler)`，poll 更新通过 handler 回传

### Requirement: ServerCommandContext for command handlers

`AgentServer` SHALL 在执行命令时为 handler 提供 `ServerCommandContext`，其中 MUST 包含 `AgentClient` 引用和 `cwd` 字符串。`ServerCommandContext` MUST NOT 包含任何 UI 回调函数（如 `setMessages`, `setIsRunning`）。

#### Scenario: Command handler receives server-only context

- **WHEN** Server 执行命令 `/compact`
- **THEN** 命令 handler 接收 `ServerCommandContext`，可调用 `ctx.client.prompt()` 或 `ctx.cwd`，但无法直接操作 React state

#### Scenario: UI update via event stream

- **WHEN** 命令执行导致状态变化（如 compaction 开始）
- **THEN** Server emit `compaction_start` 事件，Client/TUI 通过事件订阅响应并更新 UI，而非通过 handler 直接调用 UI 回调
