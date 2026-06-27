## ADDED Requirements

### Requirement: LSP 工具卡片显示

系统 SHALL 在消息列表中为 LSP 工具调用渲染专用的工具卡片，显示关键参数和结果。

#### Scenario: lsp_diagnostics 工具卡片

- **WHEN** 渲染 `lsp_diagnostics` 工具调用
- **THEN** 详情行 SHALL 显示 `filePath` + severity（若非 `"all"`）

#### Scenario: lsp_goto_definition 工具卡片

- **WHEN** 渲染 `lsp_goto_definition` 工具调用
- **THEN** 详情行 SHALL 显示 `filePath` + `line:character`

#### Scenario: lsp_find_references 工具卡片

- **WHEN** 渲染 `lsp_find_references` 工具调用
- **THEN** 详情行 SHALL 显示 `filePath` + `line:character` + includeDeclaration（若为 `false`）

#### Scenario: LSP 工具结果透传

- **WHEN** LSP 工具执行完成
- **THEN** 系统 SHALL 通过 `formatToolResult` 提取文本显示（与其他非 read 工具一致）
- **AND** 上限 15 行，超出提示"... (N more lines)"
