## ADDED Requirements

### Requirement: Compaction 事件消息渲染
系统 SHALL 订阅 Pi SDK 的 `compaction_start` 和 `compaction_end` 事件，并在 TUI 消息列表中渲染对应的助手消息。

#### Scenario: 手动 compaction 开始消息
- **WHEN** 用户执行 `/compact` 命令触发 manual compaction
- **THEN** 系统 SHALL 在消息列表追加一条助手消息，显示 "Compacting context…"

#### Scenario: Compaction 完成消息
- **WHEN** 收到 `compaction_end` 事件且 result 非空
- **THEN** 系统 SHALL 在消息列表追加一条助手消息，包含压缩前 token 数（`tokensBefore`）、压缩后估算 token 数（`estimatedTokensAfter`）和摘要文本（`summary`）
- **AND** 若 `estimatedTokensAfter` 存在，消息 SHALL 格式化为 "Context compacted: N tokens → M tokens"
- **AND** 若存在 `errorMessage`，消息 SHALL 追加错误信息

#### Scenario: Compaction 被中止
- **WHEN** 收到 `compaction_end` 事件且 `aborted` 为 true
- **THEN** 系统 SHALL 在消息列表追加助手消息 "Compaction aborted"

#### Scenario: Compaction 完成后刷新用量
- **WHEN** 收到 `compaction_end` 事件
- **THEN** 系统 SHALL 调用 `session.getContextUsage()` 并更新 contextUsage state（tokens / window / percent）

### Requirement: 上下文用量运行时更新
系统 SHALL 在多个 Agent 生命周期事件中刷新上下文用量，而非仅在 `agent_end` 时更新一次。

#### Scenario: agent_start 时更新
- **WHEN** 收到 `agent_start` 事件
- **THEN** 系统 SHALL 调用 `session.getContextUsage()` 更新 contextUsage state

#### Scenario: tool_execution_end 时更新
- **WHEN** 收到 `tool_execution_end` 事件
- **THEN** 系统 SHALL 调用 `session.getContextUsage()` 更新 contextUsage state

#### Scenario: 热切换 session 后立即初始化
- **WHEN** `setRebindSession` 回调被触发，收到新 `AgentSession`
- **THEN** 系统 SHALL 在 `setSession` 之后立即调用 `newSession.getContextUsage()` 初始化 contextUsage state
- **AND** 若返回值为 undefined，contextUsage SHALL 维持 `{ tokens: null, window: null, percent: null }`（状态栏显示 `?` 占位）
