## ADDED Requirements

### Requirement: 团队看板开屏显示

系统 SHALL 在开屏页（isWelcome 状态）且有团队成员时，自动显示 TeamDashboard 组件替代 WelcomeBanner。

#### Scenario: 有团队时开屏显示看板

- **WHEN** `isWelcome === true` 且 `members.length > 0`
- **THEN** 系统 SHALL 渲染 TeamDashboard 组件替代 WelcomeBanner
- **AND** TeamDashboard SHALL 展示 Mission / Goals / Members / Tasks 四个 section
- **AND** WelcomeBanner SHALL 不渲染

#### Scenario: 无团队时开屏显示 WelcomeBanner

- **WHEN** `isWelcome === true` 且 `members.length === 0`
- **THEN** 系统 SHALL 渲染 WelcomeBanner（保持现有行为）
- **AND** TeamDashboard SHALL 不渲染

#### Scenario: 非开屏状态默认不显示看板

- **WHEN** `isWelcome === false` 且用户未手动唤出
- **THEN** 系统 SHALL 渲染 MessageList（保持现有行为）
- **AND** TeamDashboard SHALL 不渲染

### Requirement: 看板手动唤出与关闭

系统 SHALL 支持通过 `\` 键（normal mode）随时切换 TeamDashboard 显示状态。

#### Scenario: \ 键唤出看板

- **WHEN** 用户在 normal mode 下按 `\` 键且 `showDashboard === false`
- **THEN** 系统 SHALL 设置 `showDashboard = true`
- **AND** 主内容区 SHALL 渲染 TeamDashboard 替代 MessageList 或 WelcomeBanner

#### Scenario: \ 键关闭看板

- **WHEN** 用户在 normal mode 下按 `\` 键且 `showDashboard === true`
- **THEN** 系统 SHALL 设置 `showDashboard = false`
- **AND** 主内容区 SHALL 恢复渲染 MessageList 或 WelcomeBanner

#### Scenario: Escape 或 i 关闭看板

- **WHEN** 用户在 normal mode 下按 Escape 或 i 键且 `showDashboard === true`
- **THEN** 系统 SHALL 设置 `showDashboard = false`
- **AND** 主内容区 SHALL 恢复渲染 MessageList 或 WelcomeBanner

#### Scenario: insert mode 下 \ 键不触发看板

- **WHEN** 用户在 insert mode 下按 `\` 键
- **THEN** 系统 SHALL 不触发 toggleDashboard action
- **AND** `\` 字符 SHALL 正常输入到文本框

### Requirement: 看板内容展示

系统 SHALL 在 TeamDashboard 中展示当前团队的 Mission、Goals、Members、Tasks 信息。

#### Scenario: Mission section 显示

- **WHEN** TeamDashboard 渲染且 `teamMd.mission` 非空
- **THEN** 系统 SHALL 在 Header 区域显示 `★ openagent · team mode`
- **AND** 在 Header 下方显示 `Mission: {teamMd.mission}`
- **AND** mission 文本 SHALL 截断到终端宽度（超出用 `…`）

#### Scenario: Mission 为空时省略

- **WHEN** TeamDashboard 渲染且 `teamMd.mission` 为空字符串
- **THEN** 系统 SHALL 仅显示 `★ openagent · team mode`
- **AND** 不显示 Mission 行

#### Scenario: Goals section 显示

- **WHEN** TeamDashboard 渲染且 `goals.length > 0`
- **THEN** 系统 SHALL 显示 Goals section，每个 goal 一行
- **AND** 每个 goal SHALL 显示格式：`{statusIcon} {id}: {title}  [{status}]  {priority}`
- **WHERE** statusIcon: pending=`○`, in_progress=`●`, completed=`✓`, blocked=`⊘`, cancelled=`✗`
- **AND** statusIcon SHALL 使用对应颜色：pending=`textMuted`, in_progress=`warning`, completed=`success`, blocked=`error`, cancelled=`textMuted`

#### Scenario: Goals 为空时省略 section

- **WHEN** TeamDashboard 渲染且 `goals.length === 0`
- **THEN** 系统 SHALL 不显示 Goals section

#### Scenario: Members section 显示

- **WHEN** TeamDashboard 渲染且 `members.length > 0`
- **THEN** 系统 SHALL 显示 Members section，每个 member 一行
- **AND** 每个 member SHALL 显示格式：`{statusIcon} {name}/{role}  {taskInfo}`
- **WHERE** statusIcon: active=spinner 动画, idle=`○`, done=`✓`, error=`✗`, paused=`⏸`, cancelled=`⊘`
- **AND** taskInfo: 有 currentTaskId 时显示 `· {taskId}: {taskTitle}`，无时显示 `—`
- **AND** active member（`activeMemberName` 匹配）SHALL 使用 `colors.primary` 高亮

#### Scenario: Tasks section 显示

- **WHEN** TeamDashboard 渲染且 `tasks.length > 0`
- **THEN** 系统 SHALL 显示 Tasks section，每个 task 一行
- **AND** 每个 task SHALL 显示格式：`{id}: {title}  → {assignee}  [{type}]`
- **AND** done 的 task SHALL 使用 `colors.textMuted` 色
- **AND** 未分配的 task assignee SHALL 显示 `unassigned`

#### Scenario: Tasks 为空时省略 section

- **WHEN** TeamDashboard 渲染且 `tasks.length === 0`
- **THEN** 系统 SHALL 不显示 Tasks section

### Requirement: 看板键盘导航

系统 SHALL 支持在 TeamDashboard 内通过 j/k 移动光标，Enter 执行操作。

#### Scenario: j/k 在 section 内移动光标

- **WHEN** TeamDashboard 显示且用户按 j 或 k
- **THEN** 系统 SHALL 在当前 section 内移动 cursorIndex
- **AND** j SHALL 向下移动（index + 1），到底时循环到 section 顶部
- **AND** k SHALL 向上移动（index - 1），到顶时循环到 section 底部
- **AND** 光标所在行 SHALL 使用 `colors.primary` 背景色高亮

#### Scenario: Tab 在 section 间切换

- **WHEN** TeamDashboard 显示且用户按 Tab
- **THEN** 系统 SHALL 切换 cursorSection 到下一个 section
- **AND** section 顺序为：goals → members → tasks → teams（仅 isWelcome 时包含 teams）
- **AND** cursorIndex SHALL 重置为 0

#### Scenario: Enter 选中 member

- **WHEN** 光标在 Members section 的某个 member 上且用户按 Enter
- **THEN** 系统 SHALL 调用 `setActiveMemberName(member.name)`
- **AND** 系统 SHALL 设置 `showDashboard = false`
- **AND** MessageList SHALL 显示该 member 的子会话消息

#### Scenario: Enter 选中 team（开屏页）

- **WHEN** 光标在 Other Teams section 的某个 team 上且用户按 Enter
- **THEN** 系统 SHALL 调用 `client.switchSession(sqlite://<targetSessionId>)`
- **AND** AgentServer SHALL 触发 rebind，重建 TeamManager
- **AND** TeamDashboard SHALL 自动刷新为新团队数据

#### Scenario: d 键给 member 发 directive

- **WHEN** 光标在 Members section 的某个 member 上且用户按 d
- **THEN** 系统 SHALL 设置 `setActiveMemberName(member.name)`
- **AND** 系统 SHALL 设置 `showDashboard = false`
- **AND** 输入框 SHALL 获得焦点，用户输入后通过 `client.directMember()` 发送

### Requirement: 开屏页团队切换

系统 SHALL 在开屏页的 TeamDashboard 底部显示 "Other Teams" section，列出当前 session 以外的有团队 session。

#### Scenario: Other Teams section 显示

- **WHEN** TeamDashboard 在开屏页渲染（`isWelcome === true`）且 `teamSummaries` 中有非当前 session 的团队
- **THEN** 系统 SHALL 在 Tasks section 下方显示 "Other Teams" section
- **AND** 每个团队 SHALL 显示格式：`{sessionName || sessionId}  {memberCount} members, {activeCount} active`
- **AND** 当前 session 的团队 SHALL 不出现在列表中

#### Scenario: 无其他团队时省略 section

- **WHEN** TeamDashboard 在开屏页渲染且 `teamSummaries` 中无其他团队
- **THEN** 系统 SHALL 不显示 "Other Teams" section

#### Scenario: 非开屏页不显示 Other Teams

- **WHEN** TeamDashboard 在非开屏页渲染（`isWelcome === false`）
- **THEN** 系统 SHALL 不显示 "Other Teams" section
- **AND** 切团队功能 SHALL 不可用

### Requirement: 看板实时更新

系统 SHALL 在团队状态变化时实时刷新 TeamDashboard 内容。

#### Scenario: team 事件触发刷新

- **WHEN** App.tsx 通过 `client.subscribeTeam()` 收到 team 事件
- **THEN** TeamDashboard SHALL 通过 props 接收最新的 members、tasks、goals、teamMd
- **AND** 任一 prop 变化时 TeamDashboard SHALL 重新渲染
- **AND** TeamDashboard 组件本身 SHALL NOT 直接订阅 client

#### Scenario: switchSession 后刷新

- **WHEN** 用户通过 Other Teams section 切换到新 session
- **THEN** App 的 onSessionChange 回调 SHALL 刷新 members/tasks/goals/teamMd
- **AND** TeamDashboard SHALL 显示新团队的数据
- **AND** 过渡期间（members 为空）SHALL 显示 loading 状态

### Requirement: 看板快捷键提示

系统 SHALL 在 TeamDashboard 底部显示快捷键提示行。

#### Scenario: 快捷键提示显示

- **WHEN** TeamDashboard 渲染
- **THEN** 系统 SHALL 在底部显示：`j/k=nav  Tab=section  Enter=select  \\=close  /help /model /sessions /settings  Ctrl+C=exit`
- **AND** 快捷键文本 SHALL 使用 `colors.secondary` 色
