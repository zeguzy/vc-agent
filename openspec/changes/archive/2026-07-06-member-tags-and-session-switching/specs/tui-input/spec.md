## ADDED Requirements

### Requirement: 成员标签行

系统 SHALL 在 team 模式下于输入框下方渲染成员标签行，紧凑显示所有团队成员名称和运行时状态图标。

#### Scenario: 标签行可见性

- **WHEN** `agentMode` 为 "team" 且 `client.listMembers().length > 0`
- **THEN** 输入框下方 SHALL 渲染成员标签行：`▶ leader (○) · sasha (◌) · kim (✓)`
- **WHEN** `agentMode` 不是 "team" 或成员列表为空
- **THEN** 成员标签行 SHALL 不渲染

#### Scenario: 标签行格式

- **WHEN** 渲染成员标签行
- **THEN** leader（第一项）SHALL 使用固定名 "leader"，后续项使用各成员的 `name` 字段
- **AND** 每个标签 SHALL 格式为 `name (status_icon)`
- **AND** 状态图标 SHALL 与 `WorkersView.statusIcon` 一致：◌ active、○ idle、✓ done、✗ error、⏸ paused、⊘ cancelled
- **AND** 标签之间 SHALL 用 ` · ` 分隔

#### Scenario: 活跃成员高亮

- **WHEN** `activeMemberName` 不为 null
- **THEN** 对应的成员标签 SHALL 使用 `▶` 前缀和 `colors.primary` 色高亮
- **WHEN** `activeMemberName` 为 null
- **THEN** leader 标签 SHALL 使用 `▶` 前缀高亮

#### Scenario: 标签行单行紧凑

- **WHEN** 渲染成员标签行
- **THEN** 标签行 SHALL 为单行高度（`height={1}`）
- **AND** 超出终端宽度的标签 SHALL 不换行（truncated by terminal）
- **AND** 标签行 SHALL 有 `paddingLeft={1}` `paddingRight={1}` `marginTop={0}` `marginBottom={0}`

#### Scenario: 成员列表更新时刷新

- **WHEN** 新成员被创建、成员被移除或成员状态变化
- **THEN** 标签行 SHALL 通过订阅 `client.subscribeTeam` 回调自动重渲染
