## ADDED Requirements

### Requirement: Leader 向 Member 发送指令
Leader 可以通过 member-direct 工具向运行中的 member 发送结构化消息。

#### Scenario: 发送 directive 类型消息
- **WHEN** leader 调用 member-direct(name, "directive", "stop current approach and try X instead")
- **THEN** 消息通过 session.steer()（流式时）或 session.prompt()（非流式时）注入到 member 的上下文

#### Scenario: 发送 context 类型消息
- **WHEN** leader 调用 member-direct(name, "context", "additional info: the config file is at /etc/app.yaml")
- **THEN** 消息注入到 member 上下文，member 可消费此信息

#### Scenario: 发送 redirect 类型消息
- **WHEN** leader 调用 member-direct(name, "redirect", "new task: investigate the login flow instead")
- **THEN** 消息注入到 member 上下文，member 应调整方向

#### Scenario: 向不存在的 member 发送消息
- **WHEN** leader 调用 member-direct("nonexistent", "directive", "msg")
- **THEN** 返回错误 "member not found"

#### Scenario: 向非 active member 发送消息
- **WHEN** leader 调用 member-direct(name, "directive", "msg")，member 状态不是 active
- **THEN** 返回错误 "member is not active"

### Requirement: member-direct 工具定义
member-direct 必须作为 ToolDefinition 注册到 leader 的工具集。

#### Scenario: member-direct 出现在 TEAM_ACTIVE_TOOLS
- **WHEN** agent 模式为 team
- **THEN** TEAM_ACTIVE_TOOLS 包含 "member-direct"
