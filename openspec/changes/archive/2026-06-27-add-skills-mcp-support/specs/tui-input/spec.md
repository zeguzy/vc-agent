# tui-input Delta — add-skills-mcp-support

## ADDED Requirements

### Requirement: /mcp 命令注册
系统 SHALL 通过 `CommandRegistry` 注册 `/mcp` 命令，执行时打开 MCP 连接状态面板（面板行为详见 `mcp` capability 的 "/mcp 命令面板" requirement）。

#### Scenario: 注册 /mcp
- **WHEN** 应用启动调用 `registerBuiltinCommands()`
- **THEN** `commandRegistry` SHALL 注册 `mcp` 命令，description 标明打开 MCP server 状态面板

#### Scenario: 执行 /mcp
- **WHEN** 用户执行 `/mcp`
- **THEN** 系统 SHALL 触发 App 顶层 view 切换为 MCP 面板视图，`CommandContext` SHALL 提供 `mcpManager` 访问

#### Scenario: 自动补全
- **WHEN** 用户输入 `/m` 并触发命令建议
- **THEN** `/mcp` SHALL 出现在匹配建议列表中（与 `/model` 一并匹配）
