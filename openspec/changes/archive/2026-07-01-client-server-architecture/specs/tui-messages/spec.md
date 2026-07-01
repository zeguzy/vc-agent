## MODIFIED Requirements

### Requirement: Event subscription via AgentClient

消息列表 SHALL 通过 `AgentClient.subscribe()` 接收 agent 事件，不再直接调用 `session.subscribe()`。事件类型和 payload 结构 MUST 与当前 Pi SDK 事件保持一致。

#### Scenario: Streaming message display

- **WHEN** agent 产生 `message_start` → `message_update`（多次）→ `message_end` 事件序列
- **THEN** Client 通过 `subscribe()` 注册的 handler 收到这些事件，React state 更新触发消息列表渲染

#### Scenario: Tool execution card rendering

- **WHEN** agent 产生 `tool_execution_start` 和 `tool_execution_end` 事件
- **THEN** Client handler 收到事件，ToolMessageView 渲染工具调用卡片，展示 toolName、toolArgs、toolStatus、toolResult

### Requirement: Context usage query after agent completion

`agent_end` 事件触发时，系统 SHALL 通过 `client.getContextUsage()` 查询上下文使用量，不再直接调用 `session.getContextUsage()`。

#### Scenario: Context usage display

- **WHEN** Client handler 收到 `agent_end` 事件
- **THEN** 调用 `client.getContextUsage()` 获取上下文用量，SeparatorView 渲染分隔线并显示上下文百分比

### Requirement: Message throttling in TUI layer

`message_update` 事件的 120ms 批处理节流逻辑 SHALL 保留在 TUI 层（React hook），Client 事件层不做节流。

#### Scenario: High-frequency streaming updates

- **WHEN** agent 高速产生 `message_update` 事件（如代码块连续输出）
- **THEN** Client 立即转发所有事件（无节流），TUI 的 React hook 使用 120ms setTimeout 批处理，合并多次更新为单次渲染
