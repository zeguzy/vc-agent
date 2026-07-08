## ADDED Requirements

### Requirement: tool_execution_update 事件处理
系统 SHALL 在 `useSessionEvents`（`src/tui/hooks/useSessionEvents.ts`）中处理 Pi SDK 的 `tool_execution_update` 事件，将 `partialResult` 写入对应工具消息的 `toolResult` 字段，驱动实时进度渲染。

#### Scenario: 收到 tool_execution_update
- **WHEN** `useSessionEvents` 收到 `type === "tool_execution_update"` 事件
- **THEN** 系统 SHALL 通过 `event.toolCallId` 从 `toolCallIdToMsgId` 映射找到对应 message id
- **AND** SHALL 通过 `setMessages` 更新该 message 的 `toolResult` 为 `event.partialResult`
- **AND** SHALL NOT 改变 `toolStatus`（保持 `"running"`）

#### Scenario: 未注册的 toolCallId
- **WHEN** `tool_execution_update` 的 `toolCallId` 不在 `toolCallIdToMsgId` 映射中
- **THEN** 系统 SHALL 静默忽略（不崩溃、不创建新消息）

### Requirement: subagent 工具结果结构化提取
系统 SHALL 在 `tool_execution_end` 时，若工具为 `subagent`，从 `event.result` 提取 `details` 字段写入 `message.subagentDetails`，同时保留 `toolResult` 兼容。

#### Scenario: subagent 工具完成时提取 details
- **WHEN** `tool_execution_end` 事件的 `toolName === "subagent"` 且 `event.result` 含 `details` 字段
- **THEN** 系统 SHALL 将 `event.result.details` 写入 `message.subagentDetails`
- **AND** SHALL 同时写入 `message.toolResult = event.result`（保持现有兼容）

#### Scenario: 非 subagent 工具不受影响
- **WHEN** `tool_execution_end` 的 `toolName` 不是 `"subagent"`
- **THEN** 系统 SHALL 维持现有行为（只写 `toolResult`，不写 `subagentDetails`）

### Requirement: subagent 工具 content XML 格式
系统 SHALL 让 subagent 工具（`src/tools/subagent.ts`）返回的 `content`（喂给父 LLM 的 tool_result）使用 XML 包裹格式，包含 agent 名、status、mode 和截断后的 output，对齐 opencode `<task>` 与 oh-my-pi `<task-result>` 共识。

#### Scenario: content XML 结构（single 模式）
- **WHEN** subagent 工具以 single 模式 execute 返回结果
- **THEN** `content[0].text` SHALL 为 XML 格式：
  ```
  <subagent-result agent="{agent}" status="completed|failed" mode="single">
  <output>{preview}</output>
  </subagent-result>
  ```
- **AND** `preview` SHALL 截断到 5000 字符（超出时在截断处附加 `\n… [output truncated, {N} more chars]`）
- **AND** `status` SHALL 为 `"completed"`（成功）或 `"failed"`（result.error 非空）

#### Scenario: parallel/chain 模式的 content
- **WHEN** subagent 以 parallel 或 chain 模式执行多任务
- **THEN** content SHALL 包含所有任务的 output，用 `<task>` 子节点分组：
  ```
  <subagent-result mode="parallel" status="completed">
  <task agent="{a}" description="{d}">{output}</task>
  <task agent="{b}" description="{d}">{output}</task>
  </subagent-result>
  ```
- **AND** 每个 task 的 output 各自截断到 5000 字符

#### Scenario: 工具描述补充转述提示
- **WHEN** subagent 工具的 `description`（ToolDefinition.description）被构造
- **THEN** SHALL 包含提示文本："The result returned by the subagent is not visible to the user. To show the user the result, send a text message summarizing it."
