# Spec Delta: mcp

## MODIFIED Requirements

### Requirement: MCP status 命令输出格式

`/mcp status` 命令输出 SHALL 使用状态图标替代方括号标签，并附加 server type hint。

#### Scenario: 图标映射
- **WHEN** 渲染 server 状态行
- **THEN** connected → `✓`，cached → `○`，connecting → `◌`，failed → `✗`

#### Scenario: type hint 显示
- **WHEN** server 配置的 transport type 为 streamable-http 或 sse
- **THEN** 输出 SHALL 显示 `remote` type hint
- **WHEN** server 配置的 transport type 为 stdio
- **THEN** 输出 SHALL 显示 `local` type hint
