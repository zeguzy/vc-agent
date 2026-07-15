## MODIFIED Requirements

### Requirement: 团队拓扑图渲染

系统 SHALL 在 team 模式且成员列表非空时，在 InputBox 的 textarea 上方渲染一个单行状态条组件 TeamStatusBar，替代原有的树状拓扑图组件 TeamTopology。

#### Scenario: team 模式有成员时显示状态条

- **WHEN** `agentMode === "team"` 且 `members.length > 0`
- **THEN** 系统 SHALL 在 InputBox 的 textarea 上方渲染 TeamStatusBar 组件（单行状态条）
- **AND** TeamTopology 树形组件 SHALL 不再在 InputBox 中渲染
- **AND** 状态条 SHALL 以 `★ leader` 为起始，所有 member 按 `client.listMembers()` 返回顺序依次用 `|` 分隔排列

#### Scenario: 非 team 模式或无成员时不渲染

- **WHEN** `agentMode !== "team"` 或 `members.length === 0`
- **THEN** 系统 SHALL 不渲染 TeamStatusBar 组件
- **AND** 三区域布局结构 SHALL 保持不变（消息区、输入组合区、状态栏）

#### Scenario: leader 节点显示

- **WHEN** 状态条渲染起始 segment
- **THEN** leader segment SHALL 显示为 `★ leader`
- **AND** 当 `activeMemberName === null`（用户当前在 leader 视图）时，leader segment SHALL 使用 `colors.primary` 色
- **AND** 当 `activeMemberName !== null` 时，leader segment SHALL 使用 `colors.textMuted` 色

### Requirement: 拓扑图成员节点信息

系统 SHALL 在状态条的每个 member segment 显示 status icon + name + currentTaskId 信息，单行紧凑布局。

#### Scenario: 成员 segment 基础显示

- **WHEN** 状态条渲染一个 member segment
- **THEN** segment SHALL 显示为 `{statusIcon}{name}·{currentTaskId}` 格式
- **WHERE** `statusIcon` 按 member 当前 status 渲染：active=spinner 动画帧、idle=`○`、done=`✓`、error=`✗`、paused=`⏸`、cancelled=`⊘`
- **AND** status 图标 SHALL 使用对应颜色：active=`warning`、idle=`textMuted`、done=`success`、error=`error`、paused=`info`、cancelled=`textMuted`
- **AND** 各 member segment 间 SHALL 用 ` | ` 分隔

#### Scenario: 成员有 current task 时显示 task ID

- **WHEN** member 的 `currentTaskId` 非 null
- **THEN** segment SHALL 在 name 之后追加 `·{currentTaskId}`
- **WHERE** `currentTaskId` 形如 `T1`、`T2`

#### Scenario: 成员无 current task 时省略 task 段

- **WHEN** member 的 `currentTaskId` 为 null
- **THEN** segment SHALL 不显示 `·{taskId}` 段
- **AND** segment SHALL 结束于 name 之后

#### Scenario: active member 高亮

- **WHEN** 某个 member 的 name 等于 `activeMemberName`
- **THEN** 该 member segment SHALL 使用 `colors.primary` 色
- **AND** 其他非 active member segment SHALL 使用 `colors.textMuted` 色

### Requirement: 拓扑图文本截断

系统 SHALL 根据终端实际宽度动态截断状态条文本，防止溢出。

#### Scenario: 长文本截断

- **WHEN** 状态条拼接后的总字符数超过 `process.stdout.columns - 4`（左右 padding 各 2）
- **THEN** 系统 SHALL 截断到最后一个完整 member segment 并追加 `…`
- **AND** 截断 SHALL 优先保留 leader segment 和靠前的 member segment

#### Scenario: 终端宽度不可用时回退

- **WHEN** `process.stdout.columns` 为 undefined 或 0
- **THEN** 系统 SHALL 使用 80 作为回退终端宽度

### Requirement: 拓扑图高度兜底

~~系统 SHALL 使用 scrollbox 包裹拓扑图内容，设置 maxHeight 防止极端情况挤压 MessageList。~~

此需求不再适用——TeamStatusBar 为固定单行高度，无需 scrollbox 或 maxHeight 限制。

### Requirement: 拓扑图数据更新

系统 SHALL 在团队成员状态变化时实时刷新状态条。

#### Scenario: 订阅 team 事件刷新

- **WHEN** App.tsx 已通过 `client.subscribeTeam()` 订阅团队事件
- **THEN** 状态条 SHALL 通过 props 接收最新的 `members`、`tasks`、`activeMemberName`
- **AND** 任一 prop 变化时状态条 SHALL 重新渲染
- **AND** 状态条组件本身 SHALL NOT 直接订阅 client（保持单一数据源）
