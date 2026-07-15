## ADDED Requirements

### Requirement: 单行团队状态条渲染

系统 SHALL 在 team 模式且成员列表非空时，在 InputBox 的 textarea 上方渲染一个单行状态条组件 TeamStatusBar，替代原有的 TeamTopology 树形组件。

#### Scenario: team 模式有成员时显示状态条

- **WHEN** `agentMode === "team"` 且 `members.length > 0`
- **THEN** 系统 SHALL 在 InputBox 的 textarea 上方渲染 TeamStatusBar 组件
- **AND** 状态条 SHALL 为单行高度
- **AND** 状态条 SHALL 显示格式：`★ leader | {member1} | {member2} | ...`
- **AND** 每个 member segment SHALL 显示：`{statusIcon}{name}·{currentTaskId}`
- **WHERE** statusIcon: active=`⠋`~`⠏`（spinner 动画）, idle=`○`, done=`✓`, error=`✗`, paused=`⏸`, cancelled=`⊘`

#### Scenario: 非 team 模式或无成员时不渲染

- **WHEN** `agentMode !== "team"` 或 `members.length === 0`
- **THEN** 系统 SHALL 不渲染 TeamStatusBar 组件

#### Scenario: active member 高亮

- **WHEN** 某个 member 的 name 等于 `activeMemberName`
- **THEN** 该 member segment SHALL 使用 `colors.primary` 色
- **AND** 其他 member segment SHALL 使用 `colors.textMuted` 色

#### Scenario: leader 高亮

- **WHEN** `activeMemberName === null`（用户在 leader 视图）
- **THEN** `★ leader` segment SHALL 使用 `colors.primary` 色
- **AND** 所有 member segment SHALL 使用 `colors.textMuted` 色

### Requirement: 状态条文本截断

系统 SHALL 根据终端实际宽度动态截断状态条文本，防止溢出。

#### Scenario: 成员多时截断

- **WHEN** 状态条拼接后的总字符数超过 `process.stdout.columns - 4`（左右 padding 各 2）
- **THEN** 系统 SHALL 截断到最后一个完整 member segment 并追加 `…`
- **AND** 截断 SHALL 优先保留 leader segment 和靠前的 member segment

#### Scenario: 终端宽度不可用时回退

- **WHEN** `process.stdout.columns` 为 undefined 或 0
- **THEN** 系统 SHALL 使用 80 作为回退终端宽度

### Requirement: 状态条 spinner 动画

系统 SHALL 在有 active 状态成员时启用 spinner 动画。

#### Scenario: 有 active 成员时动画

- **WHEN** `members` 中存在 `status === "active"` 的成员
- **THEN** 状态条 SHALL 每 120ms 更新 spinner frame
- **AND** active 成员的 statusIcon SHALL 循环显示 `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`

#### Scenario: 无 active 成员时停止动画

- **WHEN** `members` 中不存在 `status === "active"` 的成员
- **THEN** spinner frame SHALL 重置为 0
- **AND** 所有 statusIcon SHALL 显示静态图标
