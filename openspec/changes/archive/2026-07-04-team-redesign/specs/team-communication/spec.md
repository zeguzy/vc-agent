## ADDED Requirements

### Requirement: 成员间可通过 team channel 互发消息

系统 SHALL 提供 `send-message` action，允许成员间相互发送文本消息。消息 SHALL 对 leader 完全可见。消息 SHALL 支持指定接收者（单个成员）或广播到全体（`to="team"`）。

#### Scenario: 成员间直接通信
- **WHEN** leader 调用 `team(action="send-message", from="mem_xxx", to="mem_yyy", content="请 review 我刚刚提交的 PR")`
- **THEN** SHALL 将消息路由到目标成员的 session context（作为 system 消息注入）
- **AND** SHALL 返回 `"消息已发送: mem_xxx → mem_yyy"`
- **AND** 目标成员在下一轮 prompt 时可看到该消息

#### Scenario: 广播消息到全团队
- **WHEN** leader 调用 `team(action="send-message", from="mem_xxx", to="team", content="我完成了第一阶段，大家可以开始第二阶段了")`
- **THEN** SHALL 将消息注入所有活跃成员的 session context
- **AND** SHALL 返回 `"消息已广播给 N 个成员"`

#### Scenario: 消息截断保护
- **WHEN** 消息内容超过 2048 字符
- **THEN** SHALL 自动截断到 2048 字符并追加 `"[截断]"` 标记
- **AND** 可通过 `team(action="send-message", ..., full=true)` 发送完整内容（上限 16384）

### Requirement: Leader 可查看所有成员通信记录

系统 SHALL 在 TeamSession 中维护消息历史。Leader SHALL 可通过 `read-inbox` 查看全部或指定成员的消息。

#### Scenario: 查看团队消息历史
- **WHEN** leader 调用 `team(action="read-inbox")`
- **THEN** SHALL 返回最近 50 条消息，每条包含 from/to/content/timestamp
- **AND** 按时间倒序排列

#### Scenario: 查看特定成员的消息
- **WHEN** leader 调用 `team(action="read-inbox", memberId="mem_xxx")`
- **THEN** SHALL 返回该成员相关的所有消息（发送和接收）

### Requirement: 成员在自主工作中可请求帮助

系统 SHALL 在成员的 system prompt 中注入通信能力说明，告知成员可以向其他成员发送消息请求帮助。

#### Scenario: 成员请求代码审查
- **WHEN** 成员 Alice 在 session 中完成了代码修改
- **AND** Alice 的 prompt 指导她在需要审查时使用 team channel
- **THEN** Alice SHALL 可以通过对应的通信机制通知 leader（leader 再转发消息）

#### Scenario: 成员遇到阻塞主动报告
- **WHEN** 成员遇到无法解决的问题（如缺少权限、不确定方案）
- **THEN** 成员 SHALL 在 session 输出中标注 `[NEEDS_HELP: <reason>]`
- **AND** 该标注 SHALL 在 poll 结果中对 leader 可见
