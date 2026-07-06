# team-topology-view Specification

## Purpose
TBD - created by archiving change team-topology-tree. Update Purpose after archive.
## Requirements
### Requirement: 团队拓扑图渲染

系统 SHALL 在 team 模式且成员列表非空时，在 InputBox 与 StatusBar 之间渲染一个树状拓扑图组件，以 leader 为根节点、所有 member 为子节点。

#### Scenario: team 模式有成员时显示拓扑图

- **WHEN** `agentMode === "team"` 且 `members.length > 0`
- **THEN** 系统 SHALL 在 InputBox 之后、StatusBar 之前的位置渲染 `<TeamTopology />` 组件
- **AND** 拓扑图 SHALL 以 leader 为根节点（第 1 行），所有 member 按 `client.listMembers()` 返回顺序作为子节点依次向下排列
- **AND** 拓扑图 SHALL 使用 `├─` / `└─` / `│` 方框连线字符表达 leader → member 的父子关系

#### Scenario: 非 team 模式或无成员时不渲染

- **WHEN** `agentMode !== "team"` 或 `members.length === 0`
- **THEN** 系统 SHALL 不渲染拓扑图组件（`return null`）
- **AND** 三区域布局结构 SHALL 保持不变（消息区、输入组合区、状态栏）

#### Scenario: leader 节点显示

- **WHEN** 拓扑图渲染根节点
- **THEN** leader 节点 SHALL 显示为 `★ leader`（星号 + 固定文案 "leader"）
- **AND** 当 `activeMemberName === null`（用户当前在 leader 视图）时，leader 节点 SHALL 高亮：行首加 `▶ `，"leader" 文案使用 `colors.primary` 色
- **AND** 当 `activeMemberName !== null` 时，leader 节点 SHALL 非高亮：无 `▶` 前缀，"leader" 文案使用 `colors.textMuted` 色

### Requirement: 拓扑图成员节点信息

系统 SHALL 在每个 member 子节点显示 name + status 图标 + role + current task 信息，单行紧凑布局。

#### Scenario: 成员节点基础显示

- **WHEN** 拓扑图渲染一个 member 子节点
- **THEN** 节点 SHALL 显示为 `{treeConnector}{statusIcon} {name}/{role}` 格式
- **WHERE** `treeConnector` 为 `├─ ` 或 `└─ `（最后一个成员用 `└─ `，其他用 `├─ `）
- **AND** `statusIcon` SHALL 按 member 当前 status 渲染：active=`◌`、idle=`○`、done=`✓`、error=`✗`、paused=`⏸`、cancelled=`⊘`
- **AND** status 图标 SHALL 使用对应颜色：active=`warning`、idle=`textMuted`、done=`success`、error=`error`、paused=`info`、cancelled=`textMuted`

#### Scenario: 成员有 current task 时显示 task 信息

- **WHEN** member 的 `currentTaskId` 非 null 且能从 `client.listTasks()` 找到对应 task
- **THEN** 节点 SHALL 在 name/role 之后追加 ` · {taskId}: {taskTitle}`
- **WHERE** `taskId` 形如 `T1`、`T2`
- **AND** `taskTitle` SHALL 截断到当前行剩余宽度（超出部分用 `…` 替代）

#### Scenario: 成员无 current task 时省略 task 段

- **WHEN** member 的 `currentTaskId` 为 null 或对应 task 不存在
- **THEN** 节点 SHALL 不显示 ` · {task}` 段
- **AND** 节点 SHALL 结束于 name/role 之后

#### Scenario: active member 高亮

- **WHEN** 某个 member 的 name 等于 `activeMemberName`
- **THEN** 该成员节点 SHALL 高亮：连线字符后追加 `▶ `，name 使用 `colors.primary` 色
- **AND** 其他非 active 成员节点 SHALL 无 `▶` 前缀，name 使用 `colors.textMuted` 色

### Requirement: 拓扑图文本截断

系统 SHALL 根据终端实际宽度动态截断拓扑图每行的文本，防止溢出。

#### Scenario: 长文本截断

- **WHEN** 拓扑图某行拼接后的总字符数超过 `process.stdout.columns - 4`（左右 padding 各 2）
- **THEN** 系统 SHALL 将该行截断为 `maxWidth - 1` 个字符并追加 `…`
- **AND** 截断计算 SHALL 排除 paddingLeft/paddingRight（各 2）和树形缩进（4 列）

#### Scenario: 终端宽度不可用时回退

- **WHEN** `process.stdout.columns` 为 undefined 或 0
- **THEN** 系统 SHALL 使用 80 作为回退终端宽度

### Requirement: 拓扑图高度兜底

系统 SHALL 使用 scrollbox 包裹拓扑图内容，设置 maxHeight 防止极端情况挤压 MessageList。

#### Scenario: 成员数较少时正常显示

- **WHEN** leader + 所有 member 节点总行数 ≤ 10
- **THEN** scrollbox SHALL 表现等同普通 box（无滚动条、无溢出）
- **AND** 所有节点 SHALL 完全可见

#### Scenario: 成员数超过 maxHeight 时启用滚动

- **WHEN** leader + 所有 member 节点总行数 > 10
- **THEN** scrollbox SHALL 限制高度为 10 并启用垂直滚动
- **AND** 用户 SHALL 可通过 scrollbox 默认滚动机制查看溢出的节点

### Requirement: 拓扑图数据更新

系统 SHALL 在团队成员状态变化时实时刷新拓扑图。

#### Scenario: 订阅 team 事件刷新

- **WHEN** App.tsx 已通过 `client.subscribeTeam()` 订阅团队事件
- **THEN** 拓扑图 SHALL 通过 props 接收最新的 `members`、`tasks`、`activeMemberName`
- **AND** 任一 prop 变化时拓扑图 SHALL 重新渲染
- **AND** 拓扑图组件本身 SHALL NOT 直接订阅 client（保持单一数据源）

