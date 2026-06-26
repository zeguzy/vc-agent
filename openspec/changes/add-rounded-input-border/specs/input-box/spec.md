## MODIFIED Requirements

### Requirement: Input box border style
InputBox 组件的带四边边框的容器元素 SHALL 使用 `"rounded"` 边框样式（圆角 Unicode 字符 `╭╮╰╯`）。

#### Scenario: 输入框渲染圆角边框
- **WHEN** InputBox 组件渲染时
- **THEN** 四边边框的四个角 SHALL 显示为圆角字符（`╭` `╮` `╰` `╯`），而非直角字符（`┌` `┐` `└` `┘`）

#### Scenario: 边框颜色行为不变
- **WHEN** 组件处于 `disabled` 状态
- **THEN** 边框颜色 SHALL 保持为 `colors.borderSoft`
- **WHEN** 组件处于正常状态
- **THEN** 边框颜色 SHALL 保持为 `colors.borderActive`
