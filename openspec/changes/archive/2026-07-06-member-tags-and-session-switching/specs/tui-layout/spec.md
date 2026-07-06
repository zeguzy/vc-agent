## ADDED Requirements

### Requirement: 成员标签行布局

系统 SHALL 在输入组合区内为成员标签行预留布局空间，位于状态行和 Textarea border box 之间。

#### Scenario: 标签行位置

- **WHEN** team 模式且成员列表非空
- **THEN** 成员标签行 SHALL 渲染在 InputBox 内部、状态行的下方、Textarea 圆角边框的上方
- **AND** 标签行 SHALL 使用 `flexShrink={0}` 不参与弹性空间分配

#### Scenario: 标签行不影响三区域布局

- **WHEN** 成员标签行可见
- **THEN** 终端窗口三区域结构 SHALL 保持不变：消息区（弹性高度）、输入组合区（固定）、状态栏（固定）
- **AND** 输入组合区因标签行增加 1 行高度，消息区 SHALL 相应缩减 1 行

#### Scenario: 标签行隐藏时无额外空间

- **WHEN** team 模式关闭或成员列表为空导致标签行不可见
- **THEN** 输入组合区高度 SHALL 与当前一致（不预留空白行）
