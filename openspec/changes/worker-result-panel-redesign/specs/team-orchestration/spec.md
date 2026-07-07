# team-orchestration Specification Delta

## ADDED Requirements

### Requirement: member_done 事件携带 usage payload

成员完成任务时，`member_done` 事件须携带真实的资源消耗数据，供下游（TUI）渲染成员结果卡片。

#### Scenario: member_done payload 含 cost/tokens/turns/duration

- **WHEN** 一个成员的 session 完成并发射 `member_done` 事件
- **THEN** 事件 payload 包含：`cost`（累计成本）、`inputTokens`、`outputTokens`、`turnCount`（assistant 消息轮数）、`durationMs`（从成员创建到完成的墙钟时长）
- **AND** `cost` 不再硬编码为 `0`

### Requirement: MemberState 累积 usage

成员状态对象在生命周期内累积 usage 数据，供 `member_done` 发射时读取。

#### Scenario: message_end 累积 usage

- **WHEN** member session 发射 `message_end` 事件（assistant 消息，payload 含 input/output tokens 与 cost）
- **THEN** `MemberState.turnCount` 自增、`inputTokens`/`outputTokens`/`cost` 累加对应值
- **AND** 若 payload 缺 usage 字段，则跳过累加（不报错）

#### Scenario: 成员创建初始化 usage

- **WHEN** 一个成员被创建（createMember）
- **THEN** `MemberState.startedAt` 设为 `Date.now()`，`turnCount`/`inputTokens`/`outputTokens`/`cost` 初始化为 `0`
