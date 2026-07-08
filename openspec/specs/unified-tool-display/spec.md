# unified-tool-display Specification

## Purpose
TBD - created by archiving change unified-tool-display. Update Purpose after archive.
## Requirements
### Requirement: InputBox MCP 状态指示器

InputBox 状态行 SHALL 在 branch 之后追加 MCP 连接状态指示器，格式为 `⊙ N MCP`（N = connected + cached server 数量）。

#### Scenario: 全部连接正常
- **WHEN** 所有 MCP server 状态为 connected 或 cached
- **THEN** 状态行 SHALL 显示 `⊙ N MCP`，`⊙` 为绿色（colors.success）

#### Scenario: 有失败的 server
- **WHEN** 任一 MCP server 状态为 failed
- **THEN** 状态行 SHALL 显示 `⊙ N MCP`，`⊙` 为红色（colors.error）

#### Scenario: 无 MCP server
- **WHEN** mcpManager 无已配置的 server
- **THEN** 状态行 SHALL NOT 显示 MCP 指示器

### Requirement: /tools 统一工具命令

系统 SHALL 注册 `/tools` 命令，一屏展示当前 agent 模式的活跃工具列表 + MCP server 状态概览。

#### Scenario: standard 模式输出
- **WHEN** 用户输入 `/tools` 且当前模式为 standard
- **THEN** 输出 SHALL 包含两段：Tools 段（空格分隔的工具名列表，从 activeToolsFor(mode) 获取）+ MCP Servers 段（每行一个 server，含图标 + name + toolCount + type）

#### Scenario: team 模式输出
- **WHEN** 用户输入 `/tools` 且当前模式为 team
- **THEN** Tools 段 SHALL 包含 team 模式独有工具（team, memory, message）

#### Scenario: MCP server 状态图标
- **WHEN** 渲染 MCP server 列表
- **THEN** connected → `✓`，cached → `○`，connecting → `◌`，failed → `✗`（附内联错误）

### Requirement: /mcp status 输出风格对齐

`/mcp status` 命令输出 SHALL 使用图标替代方括号标签，附加 type hint。

#### Scenario: connected server 渲染
- **WHEN** server 状态为 connected
- **THEN** 输出行格式 SHALL 为 `  ✓ {name}  {toolCount} tools  {type}`

#### Scenario: cached server 渲染
- **WHEN** server 状态为 cached
- **THEN** 输出行 SHALL 附加 ` (background refresh)` 提示

#### Scenario: failed server 渲染
- **WHEN** server 状态为 failed
- **THEN** 输出行 SHALL 附加 ` — {error}` 内联错误

