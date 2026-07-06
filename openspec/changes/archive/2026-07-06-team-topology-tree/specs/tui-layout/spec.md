## MODIFIED Requirements

### Requirement: 成员标签行布局

系统 SHALL 在 InputBox 与 StatusBar 之间为 team 模式渲染独立的拓扑图组件（替代原 InputBox 内部的成员标签行），位于 InputBox 之后、StatusBar 之前。

#### Scenario: 拓扑图位置

- **WHEN** team 模式且成员列表非空
- **THEN** 拓扑图组件 SHALL 渲染在 InputBox 之后、StatusBar 之前
- **AND** 拓扑图 SHALL 使用 `flexShrink={0}` 不参与弹性空间分配
- **AND** 拓扑图 SHALL 接收 `members`、`tasks`、`activeMemberName` 作为 props

#### Scenario: 拓扑图不影响三区域布局

- **WHEN** 拓扑图组件可见
- **THEN** 终端窗口三区域结构 SHALL 保持不变：消息区（弹性高度）、输入组合区（固定）、状态栏（固定）
- **AND** 输入组合区因拓扑图增加 N 行高度，消息区 SHALL 相应缩减 N 行
- **AND** 拓扑图自身 SHALL 使用 maxHeight=10 兜底，防止极端情况吃掉所有消息区空间

#### Scenario: 拓扑图隐藏时无额外空间

- **WHEN** team 模式关闭或成员列表为空导致拓扑图不可见（`return null`）
- **THEN** InputBox 与 StatusBar 之间 SHALL 无额外空白
- **AND** 输入组合区高度 SHALL 与拓扑图引入前一致

### Requirement: 底部状态栏职责

系统 SHALL 将最底部状态栏限制为模式指示和上下文用量展示，不再显示成员标签。

#### Scenario: 状态栏显示模式与上下文用量

- **WHEN** 应用渲染底部状态栏
- **THEN** 状态栏 SHALL 显示当前模式（`-- INSERT --` 或 `-- NORMAL --`，颜色：insert=success绿、normal=primary蓝），右侧显示上下文用量指示器
- **AND** 状态栏 SHALL NOT 显示 leader tag、member tags、`★` 标记或任何成员相关 UI
- **AND** 状态栏 SHALL NOT 接收 `members`、`activeMemberName`、`agentMode` props

#### Scenario: 上下文用量指示器

- **WHEN** 状态栏渲染上下文用量
- **THEN** compact 模式 SHALL 显示 `◌ N%`，full 模式 SHALL 显示 `◌ tokens/window (N%)`，通过 `/context` 命令切换
- **AND** 颜色 SHALL 按用量变化：<50% success绿、50-80% warning黄、>80% error红
