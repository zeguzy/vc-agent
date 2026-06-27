# lsp-tools Specification

## Purpose
定义通过 Pi SDK customTools 机制注入的三个 LSP 工具（lsp_diagnostics、lsp_goto_definition、lsp_find_references），包括 TypeBox 参数 schema、执行逻辑和 typescript-language-server 生命周期管理。
## Requirements
### Requirement: LSP 工具注册

系统 SHALL 通过 Pi SDK 的 `customTools` 机制向 Agent 注入三个 LSP 工具：`lsp_diagnostics`、`lsp_goto_definition`、`lsp_find_references`。每个工具 SHALL 包含完整的 TypeBox 参数 schema、LLM 友好的描述文本和 `execute` 实现。

#### Scenario: 工具注入到 Agent 会话

- **WHEN** `createAgentSession()` 被调用
- **THEN** `customTools` 参数 SHALL 包含三个 ToolDefinition 对象
- **AND** LLM SHALL 能够在 system prompt 中看到这些工具的描述和参数 schema

#### Scenario: typescript-language-server 不可用时降级

- **WHEN** typescript-language-server 未安装或启动失败
- **THEN** LSP 工具 SHALL 仍然注册但在执行时返回友好错误消息
- **AND** 不影响其他内置工具（read、bash 等）的正常使用

### Requirement: lsp_diagnostics 工具

系统 SHALL 提供 `lsp_diagnostics` 工具，获取指定文件的 LSP 诊断信息（错误、警告、提示）。

#### Scenario: 获取文件诊断

- **WHEN** LLM 调用 `lsp_diagnostics({ filePath: "/abs/path/to/file.ts" })`
- **THEN** 系统 SHALL 向 LSP 服务器发送 `textDocument/didOpen` 通知
- **AND** 等待并返回 `textDocument/publishDiagnostics` 的结果

#### Scenario: 按 severity 过滤

- **WHEN** LLM 调用 `lsp_diagnostics({ filePath: "...", severity: "error" })`
- **THEN** 系统 SHALL 只返回 severity 为 error 的诊断项
- **AND** 支持的值包括 `"error"`、`"warning"`、`"information"`、`"hint"`、`"all"`（默认）

#### Scenario: 输出格式

- **WHEN** 诊断结果成功返回
- **THEN** 输出格式 SHALL 为 `{severity} [{line}:{character}]: {message}`
- **AND** 上限 50 条，超出时提示"Found N diagnostics (showing first 50)"

#### Scenario: 文件无诊断

- **WHEN** 文件没有任何诊断
- **THEN** 系统 SHALL 返回 "No diagnostics found"

### Requirement: lsp_goto_definition 工具

系统 SHALL 提供 `lsp_goto_definition` 工具，获取指定光标位置的符号定义位置。

#### Scenario: 跳转到定义

- **WHEN** LLM 调用 `lsp_goto_definition({ filePath: "...", line: 42, character: 5 })`
- **THEN** 系统 SHALL 向 LSP 服务器发送 `textDocument/definition` 请求
- **AND** 返回格式 SHALL 为 `/absolute/path/to/file.ts:line:character`

#### Scenario: 符号无定义

- **WHEN** 光标位置没有可解析的定义
- **THEN** 系统 SHALL 返回 "No definition found"

#### Scenario: 参数校验

- **WHEN** 调用缺少 `filePath`、`line` 或 `character`
- **THEN** 系统 SHALL 返回明确的参数错误消息

### Requirement: lsp_find_references 工具

系统 SHALL 提供 `lsp_find_references` 工具，查找符号的所有引用位置。

#### Scenario: 查找引用

- **WHEN** LLM 调用 `lsp_find_references({ filePath: "...", line: 42, character: 5 })`
- **THEN** 系统 SHALL 向 LSP 服务器发送 `textDocument/references` 请求
- **AND** 返回格式 SHALL 为每行一个 `{file}:{line}:{character}`

#### Scenario: 包含/排除声明

- **WHEN** `includeDeclaration` 为 `false`
- **THEN** 系统 SHALL 从结果中排除声明位置

#### Scenario: 引用数量限制

- **WHEN** 引用数量超过 100
- **THEN** 系统 SHALL 返回 "Found N references (showing first 100):" 后跟结果
- **AND** 最多显示前 100 条

#### Scenario: 无引用

- **WHEN** 符号没有任何引用
- **THEN** 系统 SHALL 返回 "No references found"

### Requirement: LSP 服务器生命周期管理

系统 SHALL 管理 typescript-language-server 进程的生命周期。

#### Scenario: LSP 服务器启动

- **WHEN** Agent 会话创建且项目含 `tsconfig.json`
- **THEN** 系统 SHALL 自动启动 typescript-language-server 进程
- **AND** 通过 stdio 建立 JSON-RPC 通信

#### Scenario: 服务器启动失败

- **WHEN** typescript-language-server 未安装或启动异常
- **THEN** 系统 SHALL 记录诊断警告但不阻断会话创建
- **AND** LSP 工具调用时 SHALL 返回友好错误消息

#### Scenario: 会话结束时清理

- **WHEN** Agent 会话被销毁（quit、switch session）
- **THEN** 系统 SHALL 发送 `shutdown` 请求并等待 `exit` 通知
- **AND** 终止子进程
