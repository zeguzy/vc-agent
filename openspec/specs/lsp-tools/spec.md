# lsp-tools Specification

## Purpose
定义通过 Pi SDK customTools 机制注入的统一 LSP 工具 `lsp`，支持 14 种 action（diagnostics、definition、type_definition、implementation、references、hover、document_symbols、workspace_symbols、code_actions、rename、prepare_rename、status、reload、request），包括 TypeBox 参数 schema、执行逻辑和 typescript-language-server 生命周期管理。

## Requirements

### Requirement: 统一 LSP 工具注册

系统 SHALL 通过 Pi SDK 的 `customTools` 机制向 Agent 注入单个 ToolDefinition 对象，名称为 `lsp`，包含 `action` 枚举参数用于选择 14 种 LSP 操作。工具 SHALL 包含完整的 TypeBox 参数 schema、LLM 友好的描述文本、promptSnippet 和 promptGuidelines。

#### Scenario: 工具注入到 Agent 会话

- **WHEN** `createAgentSession()` 被调用
- **THEN** `customTools` 参数 SHALL 包含一个名为 `lsp` 的 ToolDefinition 对象
- **AND** LLM SHALL 能够在 system prompt 中看到工具描述和 14 种 action 的参数 schema

#### Scenario: typescript-language-server 不可用时降级

- **WHEN** typescript-language-server 未安装或启动失败
- **THEN** `lsp` 工具 SHALL 仍然注册但在执行时返回友好错误消息，包含安装指导
- **AND** 不影响其他内置工具（read、bash 等）的正常使用

### Requirement: action 参数

系统 SHALL 通过 `action` 枚举参数支持 14 种操作：`diagnostics`、`definition`、`type_definition`、`implementation`、`references`、`hover`、`document_symbols`、`workspace_symbols`、`code_actions`、`rename`、`prepare_rename`、`status`、`reload`、`request`。

### Requirement: symbol 列号解析

系统 SHALL 支持 `symbol` 参数作为 `character` 的替代方案。当提供 `symbol` 时，系统 SHALL 读取文件对应行，查找 symbol 文本的首次出现位置作为 character 列号。当 `character` 和 `symbol` 同时提供时，SHALL 优先使用 `character`。

#### Scenario: 通过 symbol 名称定位

- **WHEN** LLM 调用 `lsp({ action: "definition", file: "...", line: 10, symbol: "myFunc" })`
- **THEN** 系统 SHALL 在第 10 行查找 "myFunc" 的列号
- **AND** 使用解析出的列号发起 LSP 请求

### Requirement: diagnostics action

系统 SHALL 提供 `diagnostics` action，获取指定文件的 LSP 诊断信息。

#### Scenario: 获取文件诊断

- **WHEN** LLM 调用 `lsp({ action: "diagnostics", file: "/abs/path/to/file.ts" })`
- **THEN** 系统 SHALL 向 LSP 服务器发送 `textDocument/didOpen` 通知
- **AND** 等待并返回 `textDocument/publishDiagnostics` 的结果

#### Scenario: 按 severity 过滤

- **WHEN** LLM 调用 `lsp({ action: "diagnostics", file: "...", severity: "error" })`
- **THEN** 系统 SHALL 只返回 severity 为 error 的诊断项

#### Scenario: 输出格式

- **WHEN** 诊断结果成功返回
- **THEN** 输出格式 SHALL 为 `{severity} [{line}:{character}]: {message}`
- **AND** 上限 50 条，超出时提示 "Found N diagnostics (showing first 50)"

#### Scenario: 文件无诊断

- **WHEN** 文件没有任何诊断
- **THEN** 系统 SHALL 返回 "No diagnostics found"

### Requirement: definition / type_definition / implementation actions

系统 SHALL 提供三种导航 action，分别对应 `textDocument/definition`、`textDocument/typeDefinition`、`textDocument/implementation` LSP 请求。

#### Scenario: 跳转到定义

- **WHEN** LLM 调用 `lsp({ action: "definition", file: "...", line: 42, symbol: "myFunc" })`
- **THEN** 系统 SHALL 发送 `textDocument/definition` 请求
- **AND** 返回格式 SHALL 为 `/absolute/path/to/file.ts:line:character`
- **AND** LocationLink 响应 SHALL 被规范化为 Location

#### Scenario: 无结果

- **WHEN** 光标位置没有可解析的定义/类型定义/实现
- **THEN** 系统 SHALL 返回 "No definition found" / "No type definition found" / "No implementation found"

### Requirement: references action

系统 SHALL 提供 `references` action，查找符号的所有引用位置。

#### Scenario: 查找引用

- **WHEN** LLM 调用 `lsp({ action: "references", file: "...", line: 42, symbol: "myFunc" })`
- **THEN** 系统 SHALL 发送 `textDocument/references` 请求
- **AND** 返回格式 SHALL 为每行一个 `{file}:{line}:{character}`

#### Scenario: 重试逻辑

- **WHEN** 首次返回 0 或 1 个引用（可能服务器尚未完全加载项目）
- **THEN** 系统 SHALL 最多重试 3 次（间隔 250ms）以获取更完整的结果

### Requirement: hover action

系统 SHALL 提供 `hover` action，获取符号的类型/签名信息。

#### Scenario: 获取 hover 信息

- **WHEN** LLM 调用 `lsp({ action: "hover", file: "...", line: 10, symbol: "myVar" })`
- **THEN** 系统 SHALL 发送 `textDocument/hover` 请求
- **AND** 返回 MarkupContent 或 MarkedString 的文本内容

### Requirement: document_symbols / workspace_symbols actions

系统 SHALL 提供两种 symbol 搜索 action。

#### Scenario: 文档符号列表

- **WHEN** LLM 调用 `lsp({ action: "document_symbols", file: "..." })`
- **THEN** 系统 SHALL 发送 `textDocument/documentSymbol` 请求
- **AND** 返回带缩进的符号树，格式为 `{icon} {name} [{line}] — {detail}`

#### Scenario: 工作区符号搜索

- **WHEN** LLM 调用 `lsp({ action: "workspace_symbols", query: "MyClass" })`
- **THEN** 系统 SHALL 发送 `workspace/symbol` 请求
- **AND** 返回格式为 `{icon} {name} — {path}:{line}`

### Requirement: code_actions action

系统 SHALL 提供 `code_actions` action，支持列出和应用 code actions。

#### Scenario: 列出可用 code actions

- **WHEN** LLM 调用 `lsp({ action: "code_actions", file: "...", line: 10, symbol: "..." })`
- **THEN** 系统 SHALL 发送 `textDocument/codeAction` 请求（含当前 diagnostics 上下文）
- **AND** 返回编号列表 `[0] {title} ({kind})`

#### Scenario: 预览 code action 编辑

- **WHEN** LLM 调用 `lsp({ action: "code_actions", file: "...", line: 10, index: 0 })`
- **THEN** 系统 SHALL 通过 `codeAction/resolve` 解析 edit（如需要）
- **AND** 返回 WorkspaceEdit 预览

#### Scenario: 应用 code action

- **WHEN** LLM 调用 `lsp({ action: "code_actions", file: "...", line: 10, index: 0, apply: true })`
- **THEN** 系统 SHALL 将 WorkspaceEdit 写入磁盘
- **AND** 返回修改的文件列表

### Requirement: rename / prepare_rename actions

系统 SHALL 提供 `rename` 和 `prepare_rename` action。

#### Scenario: 预览重命名

- **WHEN** LLM 调用 `lsp({ action: "rename", file: "...", line: 10, symbol: "oldName", new_name: "newName" })`
- **THEN** 系统 SHALL 发送 `textDocument/rename` 请求
- **AND** 返回 WorkspaceEdit 预览

#### Scenario: 应用重命名

- **WHEN** LLM 调用 `lsp({ action: "rename", ..., apply: true })`
- **THEN** 系统 SHALL 将 WorkspaceEdit 写入磁盘
- **AND** 返回修改的文件列表

#### Scenario: 检查重命名可用性

- **WHEN** LLM 调用 `lsp({ action: "prepare_rename", file: "...", line: 10, symbol: "..." })`
- **THEN** 系统 SHALL 发送 `textDocument/prepareRename` 请求
- **AND** 返回可重命名范围或 "Rename is not available at this position"

### Requirement: status / reload / request actions

系统 SHALL 提供辅助 action。

#### Scenario: 服务器状态

- **WHEN** LLM 调用 `lsp({ action: "status" })`
- **THEN** 系统 SHALL 返回服务器就绪状态和能力列表（✓/✗）

#### Scenario: 重新加载文件

- **WHEN** LLM 调用 `lsp({ action: "reload", file: "..." })`
- **THEN** 系统 SHALL 发送 `textDocument/didSave` 通知并重新打开文件
- **AND** 返回刷新后的诊断信息

#### Scenario: 原始 LSP 请求

- **WHEN** LLM 调用 `lsp({ action: "request", payload: { method: "textDocument/completion", params: {...} } })`
- **THEN** 系统 SHALL 透传原始 JSON-RPC 请求
- **AND** 返回 JSON 格式的原始响应

### Requirement: WorkspaceEdit 应用

系统 SHALL 支持将 LSP WorkspaceEdit 应用到磁盘文件。

#### Scenario: changes 格式

- **WHEN** WorkspaceEdit 包含 `changes` 字段
- **THEN** 系统 SHALL 对每个 URI 的 TextEdit 数组按位置倒序排列并逐个应用
- **AND** 写回修改后的文件内容

#### Scenario: documentChanges 格式

- **WHEN** WorkspaceEdit 包含 `documentChanges` 数组
- **THEN** 系统 SHALL 支持 TextDocumentEdit、CreateFile、RenameFile、DeleteFile 四种操作类型

### Requirement: LSP 服务器能力追踪

系统 SHALL 在 initialize 握手后追踪服务器能力（ServerCapabilities）。

#### Scenario: 能力查询

- **WHEN** 工具需要判断某个 LSP 方法是否可用
- **THEN** 系统 SHALL 通过 `hasCapability()` 查询对应能力字段

### Requirement: LSP 服务器生命周期管理

系统 SHALL 管理 typescript-language-server 进程的生命周期。

#### Scenario: LSP 服务器启动

- **WHEN** Agent 会话创建且项目含 `tsconfig.json`
- **THEN** 系统 SHALL 自动启动 typescript-language-server 进程
- **AND** 通过 stdio 建立 JSON-RPC 通信
- **AND** 在 initialize 握手后保存服务器能力

#### Scenario: 服务器启动失败

- **WHEN** typescript-language-server 未安装或启动异常
- **THEN** 系统 SHALL 记录诊断警告但不阻断会话创建
- **AND** `lsp` 工具调用时 SHALL 返回友好错误消息，包含安装指导

#### Scenario: 会话结束时清理

- **WHEN** Agent 会话被销毁（quit、switch session）
- **THEN** 系统 SHALL 发送 `shutdown` 请求并等待 `exit` 通知
- **AND** 终止子进程
