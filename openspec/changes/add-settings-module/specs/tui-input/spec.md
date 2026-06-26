## MODIFIED Requirements

### Requirement: Slash Command
系统 SHALL 支持以 `/` 开头的命令输入，提供自动补全建议列表和命令分发。

#### Scenario: 命令建议
- **WHEN** 用户输入 `/` 开头的内容
- **THEN** 系统 SHALL 在输入框上方显示匹配的命令建议列表（命令名 + 描述），当前选中项用 `▶` 标记

#### Scenario: 建议导航
- **WHEN** 建议列表可见且用户按 `↑`/`↓`
- **THEN** 系统 SHALL 上下移动选中项

#### Scenario: Tab 补全
- **WHEN** 建议列表可见且用户按 Tab
- **THEN** 系统 SHALL 将选中命令补全到输入框（`/command ` 格式）

#### Scenario: 命令执行
- **WHEN** 用户在 `/` 开头时按 Enter
- **THEN** 系统 SHALL 执行匹配的选中命令（通过 `matchCommands` 解析），不发送给 Agent
- **AND** 支持的命令：`/clear`、`/compact`、`/model`、`/thinking`、`/context`、`/exit`、`/help`、`/setting`

#### Scenario: /setting 打开设置页面
- **WHEN** 用户执行 `/setting` 命令
- **THEN** 系统 SHALL 触发 App 顶层 `view` 切换为 `"settings"`，整屏渲染设置页面（详见 `settings` capability 的 "/setting 设置页面" requirement）
