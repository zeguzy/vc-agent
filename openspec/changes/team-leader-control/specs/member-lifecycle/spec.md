## ADDED Requirements

### Requirement: Member 暂停
Leader 可以暂停运行中的 member。

#### Scenario: 暂停 active member
- **WHEN** leader 调用 pauseMember(name)，member 状态为 "active"
- **THEN** member 的 AgentSession 调用 abort()，member 状态变为 "paused"，TEAM.md 同步更新

#### Scenario: 暂停 idle member 无效
- **WHEN** leader 调用 pauseMember(name)，member 状态为 "idle"
- **THEN** 操作被忽略，member 状态不变

### Requirement: Member 恢复
Leader 可以恢复已暂停的 member。

#### Scenario: 恢复 paused member
- **WHEN** leader 调用 resumeMember(name)，member 状态为 "paused"
- **THEN** member 的 AgentSession 调用 prompt(lastTaskPrompt)，member 状态变为 "active"，TEAM.md 同步更新

#### Scenario: 恢复非 paused member 无效
- **WHEN** leader 调用 resumeMember(name)，member 状态不是 "paused"
- **THEN** 操作被忽略，member 状态不变

### Requirement: Member 取消
Leader 可以取消 member，member 进入终态。

#### Scenario: 取消 active member
- **WHEN** leader 调用 cancelMember(name)，member 状态为 "active"
- **THEN** member 的 AgentSession 调用 abort() + dispose()，member 状态变为 "cancelled"，TEAM.md 同步更新，member 从活跃列表移除

#### Scenario: 取消 paused member
- **WHEN** leader 调用 cancelMember(name)，member 状态为 "paused"
- **THEN** 同取消 active member 的行为

### Requirement: Member 状态机
Member 状态转换必须遵循以下规则。

#### Scenario: 状态转换规则
- **WHEN** member 状态转换
- **THEN** 允许的转换：idle→active（assignTask），active→idle（agent_end），active→paused（pause），paused→active（resume），active→cancelled（cancel），paused→cancelled（cancel）。其他转换无效。

### Requirement: Paused 状态可见
paused 状态必须在客户端接口和 TUI 中可见。

#### Scenario: listMembers 返回 paused member
- **WHEN** 调用 listMembers()
- **THEN** 返回结果中包含 status 为 "paused" 的 member

#### Scenario: TUI 展示 paused 图标
- **WHEN** member 状态为 paused
- **THEN** WorkersView 中显示对应的暂停图标
