## ADDED Requirements

### Requirement: AgentClient interface definition

系统 SHALL 定义 `AgentClient` 接口作为 TUI 与核心引擎之间的唯一通信契约。接口 MUST 包含以下方法分类：

- **会话操作**：`prompt(text)`, `followUp(text)`, `abort()`
- **会话管理**：`listSessions()`, `switchSession(id)`, `newSession(mode)`, `setSessionName(name)`
- **状态查询**：`getContextUsage()`, `getAgentMode()`, `setAgentMode(mode)`
- **事件订阅**：`subscribe(handler): Unsubscribe`
- **命令执行**：`executeCommand(name, args): Promise<CommandResult>`
- **轮询订阅**：`subscribePoll(key, handler): Unsubscribe`

接口 MUST 为 TypeScript interface（非 type alias），以支持多态实现。

#### Scenario: TUI receives AgentClient via props

- **WHEN** 应用启动并渲染 `<App>`
- **THEN** `<App>` 及其子组件通过 props 接收 `AgentClient` 实例，不直接持有 `AgentSessionRuntime` 或 `AgentSession` 引用

#### Scenario: Type safety across boundary

- **WHEN** 开发者编写 TUI 代码调用 client 方法
- **THEN** TypeScript 编译器提供完整的类型检查和 IDE 自动补全，无需查阅文档

### Requirement: In-process client implementation

系统 SHALL 提供 `InProcessClient` 作为 `AgentClient` 接口的默认实现。该实现 MUST 通过直接函数调用委托给 `AgentServer`，不经过任何 IPC 或序列化。

#### Scenario: Zero-overhead local operation

- **WHEN** TUI 调用 `client.prompt("hello")` 在本地 in-process 模式下
- **THEN** 调用直接转发到 `server.handlePrompt("hello")`，无 JSON 序列化、无管道通信、无 Worker 消息传递

#### Scenario: Event subscription in local mode

- **WHEN** TUI 调用 `client.subscribe(handler)` 注册事件处理器
- **THEN** handler 通过同步函数调用被触发（EventEmitter 模式），事件 payload 为原始对象引用（非反序列化副本）

### Requirement: Transport swappability

`AgentClient` 接口的设计 MUST 允许在不改变 TUI 代码的前提下替换 transport 实现。

#### Scenario: Future HTTP transport

- **WHEN** 未来添加基于 HTTP + SSE 的 `HttpClient` 实现
- **THEN** TUI 代码无需任何修改，只需在启动时注入不同的 `AgentClient` 实例

### Requirement: Event stream interface

`AgentClient` 的 `subscribe` 方法 SHALL 提供统一的事件流接口。事件类型 MUST 覆盖当前 Pi SDK 的全部 9 种事件：`agent_start`, `message_start`, `message_update`, `message_end`, `tool_execution_start`, `tool_execution_end`, `compaction_start`, `compaction_end`, `agent_end`。

#### Scenario: Streaming message updates

- **WHEN** agent 正在生成回复并产生 `message_update` 事件
- **THEN** 注册的 handler 收到包含增量文本的事件 payload，payload 结构与当前 `session.subscribe()` 回调一致

#### Scenario: Event throttling preservation

- **WHEN** TUI 需要对高频 `message_update` 事件进行批处理
- **THEN** 批处理逻辑在 TUI 侧（React hook）实现，Client 事件层不做节流，保持事件完整性

### Requirement: Unsubscribe contract

`subscribe` 和 `subscribePoll` 方法 SHALL 返回一个 `Unsubscribe` 函数。调用该函数 MUST 移除对应的事件处理器，且不触发后续事件。

#### Scenario: Component unmount cleanup

- **WHEN** React 组件卸载时调用 unsubscribe 函数
- **THEN** 该组件注册的事件处理器不再被调用，不产生内存泄漏
