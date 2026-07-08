# Spec Delta: tui-messages

## MODIFIED Requirements

### Requirement: 工具调用卡片

`formatToolDetail()` 函数 SHALL 为以下工具提供专用 case，提取参数生成 label + lines：

#### Scenario: MCP 工具调用
- **WHEN** 工具名为 `mcp`
- **THEN** label SHALL 为 `{server_name} · {tool_name}`，lines SHALL 为 arguments 中的前 3 个 primitive key-value 对（格式 `key=value`，value 截断 50 字符，key 名含 key/token/secret/password 时跳过）

#### Scenario: glob 工具调用
- **WHEN** 工具名为 `glob`
- **THEN** label SHALL 为 `glob`，lines SHALL 为 `[pattern]` + 可选 `[path]`

#### Scenario: webfetch 工具调用
- **WHEN** 工具名为 `webfetch`
- **THEN** label SHALL 为 `webfetch`，lines SHALL 为 `[url]`

#### Scenario: question 工具调用
- **WHEN** 工具名为 `question`
- **THEN** label SHALL 为 `question`，lines SHALL 为各 question 的 header，逗号分隔

#### Scenario: todo 工具调用
- **WHEN** 工具名为 `todo`
- **THEN** label SHALL 为 `todo`，lines SHALL 为 `[action]`（如 "add", "update", "list"）

#### Scenario: 未列出的工具保持 default
- **WHEN** 工具名不在 read/bash/edit/write/grep/find/lsp/subagent/mcp/glob/webfetch/question/todo/notify 中
- **THEN** label SHALL 为工具名，lines SHALL 为空数组
