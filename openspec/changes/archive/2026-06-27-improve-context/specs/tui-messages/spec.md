## ADDED Requirements

### Requirement: Compaction 消息渲染
系统 SHALL 将 compaction 生命周期事件渲染为消息列表中的助手消息。

#### Scenario: Compaction 开始
- **WHEN** 收到 `compaction_start` 事件（reason 为 "manual" 或 "threshold" 或 "overflow"）
- **THEN** 系统 SHALL 在消息列表追加一条 assistant 消息，内容为 "Compacting context…"

#### Scenario: Compaction 完成（成功）
- **WHEN** 收到 `compaction_end` 事件且 `aborted` 为 false 且 `result` 非空
- **THEN** 系统 SHALL 在消息列表追加一条 assistant 消息，内容包含：
  - 压缩前 token 数（`result.tokensBefore`）
  - 压缩后估算 token 数（`result.estimatedTokensAfter`，若存在）
  - 摘要内容（`result.summary`）
- **AND** 消息格式 SHALL 为 "Context compacted: {before} tokens → {after} tokens\n{summary}"

#### Scenario: Compaction 完成（被中止）
- **WHEN** 收到 `compaction_end` 事件且 `aborted` 为 true
- **THEN** 系统 SHALL 在消息列表追加一条 assistant 消息 "Compaction aborted"

#### Scenario: Compaction 完成（出错）
- **WHEN** 收到 `compaction_end` 事件且 `errorMessage` 非空
- **THEN** 系统 SHALL 在消息列表追加一条 assistant 消息 "Compaction failed: {errorMessage}"
