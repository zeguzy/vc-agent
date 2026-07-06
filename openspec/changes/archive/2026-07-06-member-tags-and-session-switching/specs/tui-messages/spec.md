## ADDED Requirements

### Requirement: 成员消息源切换

系统 SHALL 支持 MessageList 根据 `activeMemberName` 状态切换消息源，显示不同成员的子会话消息。

#### Scenario: 成员消息源

- **WHEN** `activeMemberName` 不为 null
- **THEN** MessageList SHALL 从 `client.getMember(activeMemberName).session.messages` 获取消息并通过 `mapSdkMessagesToTui()` 转换后渲染
- **AND** 成员消息 SHALL 使用完整的消息渲染规则（用户消息气泡、工具卡片、read 合并等）

#### Scenario: leader 消息源

- **WHEN** `activeMemberName` 为 null
- **THEN** MessageList SHALL 渲染 `messages` state（orchestrator 主会话消息）
- **AND** 行为与当前一致

#### Scenario: 切换时滚动到底部

- **WHEN** `activeMemberName` 变化（切换成员）
- **THEN** 消息列表 SHALL 自动滚动到底部
