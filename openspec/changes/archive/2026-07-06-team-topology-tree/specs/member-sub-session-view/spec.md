## MODIFIED Requirements

### Requirement: 成员子会话视图切换

系统 SHALL 支持在 team 模式下通过快捷键切换成员子会话视图，允许用户查看任意团队成员的完整对话历史。切换的视觉反馈通过 InputBox 与 StatusBar 之间的拓扑图节点高亮体现（不再使用 StatusBar 内的成员标签行）。

#### Scenario: 切换到成员子会话

- **WHEN** 用户在 team 模式下按 `[` 或 `]` 键
- **THEN** 系统 SHALL 切换到上一个或下一个成员（按 `client.listMembers()` 返回的顺序）
- **AND** leader（orchestrator）视图 SHALL 作为列表第一项，`[` 从第一个成员循环到 leader

#### Scenario: 成员子会话消息显示

- **WHEN** 用户切换到某个成员（如 "sasha"）
- **THEN** MessageList SHALL 显示该成员的子会话消息（从 `MemberState.session.messages` 经 `mapSdkMessagesToTui` 转换）
- **AND** 消息列表 SHALL 滚动到底部
- **AND** 系统 SHALL 订阅该成员的 `session` 事件，成员产生新消息时视图 SHALL 实时更新

#### Scenario: 成员会话为空

- **WHEN** 用户切换到一个还没有任何消息的成员
- **THEN** MessageList SHALL 显示占位提示 "No messages yet. `name` is working..."

#### Scenario: 切换回 leader 视图

- **WHEN** 用户通过 `[` / `]` 切换到 leader（列表第一项）或调用 `setActiveMemberName(null)`
- **THEN** MessageList SHALL 恢复显示 orchestrator 的主会话消息
- **AND** 输入框提交行为 SHALL 恢复为 `client.prompt()` / `client.followUp()`

#### Scenario: 成员被删除时自动返回

- **WHEN** 当前聚焦的成员在后台被删除（`client.getMember(name)` 返回 undefined）
- **THEN** 系统 SHALL 自动将 `activeMemberName` 设为 null，恢复 leader 视图
- **AND** 系统 SHALL 推送一条 toast 通知 "Member `name` was removed"

#### Scenario: 切换时拓扑图节点高亮

- **WHEN** 用户通过 `[` / `]` 切换 active member
- **THEN** 拓扑图 SHALL 立即重新渲染，新 active 成员节点 SHALL 高亮（`▶` 前缀 + primary 色），原 active 成员节点 SHALL 恢复非高亮
- **AND** 当 active 回到 leader 时，leader 节点 SHALL 高亮，所有 member 节点 SHALL 非高亮

#### Scenario: 仅 team 模式生效

- **WHEN** `agentMode` 不是 "team"
- **THEN** `[` / `]` 快捷键 SHALL 不触发成员切换（无操作）
- **AND** 拓扑图组件 SHALL 不可见（`return null`）
