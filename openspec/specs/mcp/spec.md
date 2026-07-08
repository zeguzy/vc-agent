# mcp Specification

## Purpose
TBD - created by archiving change add-skills-mcp-support. Update Purpose after archive.
## Requirements
### Requirement: MCP 配置文件加载
系统 SHALL 从独立 `mcp.json` 文件加载 MCP server 配置，格式对齐 opencode 的 `mcp` 字段语义（顶层为 `Record<server-name, ServerDef>`，`type` 仅 `local|remote`）。全局 `~/.config/openagent/mcp.json` 与项目 `.openagent/mcp.json` SHALL 通过 deepMerge 合并（项目覆盖全局）。`config.json` SHALL NOT 包含任何 mcp 字段。

#### Scenario: 全局配置读取
- **WHEN** `~/.config/openagent/mcp.json` 存在
- **THEN** 系统 SHALL 读取并解析为 server 名到定义的映射

#### Scenario: 项目配置覆盖全局
- **WHEN** `.openagent/mcp.json` 与全局 `mcp.json` 同时存在且含同名 server
- **THEN** 系统 SHALL 用 deepMerge 合并（复用 `src/config.ts` 的 `deepMerge`），项目配置覆盖全局同名 server

#### Scenario: 无配置文件
- **WHEN** 两处 `mcp.json` 均不存在
- **THEN** 系统 SHALL 使用空配置（无 server 连接），不报错，不阻塞会话创建

#### Scenario: opencode local 格式
- **WHEN** server 定义为 `{ type:"local", command:["npx","-y","srv"], environment:{TOKEN:"x"} }`
- **THEN** 配置 SHALL 被接受（`command` 为合并数组，`environment` 为环境变量 map）

#### Scenario: opencode remote 格式
- **WHEN** server 定义为 `{ type:"remote", url:"https://...", headers:{...} }`
- **THEN** 配置 SHALL 被接受（transport 类型运行时协商）

#### Scenario: 配置不进 config.json
- **WHEN** 读取 MCP 配置
- **THEN** 系统 SHALL 仅读 `mcp.json`，SHALL NOT 从 `config.json` 读取任何 mcp 字段

### Requirement: opencode 配置适配
系统 SHALL 提供 `adaptToTransports` 纯函数，把 opencode 格式配置翻译为 openagent 内部的 `McpServerConfig[]`（每项含 `name`、`transport`、`enabled`、`autoReconnect`）。

#### Scenario: local 转 stdio
- **WHEN** 输入 `{ type:"local", command:["npx","-y","srv"], environment:{TOKEN:"x"}, cwd:"/p" }`
- **THEN** 输出 `transport:{ type:"stdio", command:"npx", args:["-y","srv"], env:{TOKEN:"x"}, cwd:"/p" }`

#### Scenario: remote 转 streamable-http
- **WHEN** 输入 `{ type:"remote", url:"https://x", headers:{Auth:"..."} }`
- **THEN** 输出 `transport:{ type:"streamable-http", url:"https://x", headers:{Auth:"..."} }`

#### Scenario: 命令数组首元素拆分
- **WHEN** opencode `command` 为多元素数组
- **THEN** 首元素 SHALL 成为 `transport.command`（string），剩余元素 SHALL 成为 `transport.args`（string[]）

#### Scenario: 字段名映射
- **WHEN** 适配 opencode 配置
- **THEN** `environment` SHALL 映射为 `env`；`type:"local"` SHALL 映射为 `transport.type:"stdio"`；`type:"remote"` SHALL 映射为 `transport.type:"streamable-http"`

#### Scenario: enabled 与重连默认值
- **WHEN** opencode 定义未指定 `enabled`
- **THEN** `McpServerConfig.enabled` SHALL 默认 `true`，`autoReconnect` SHALL 默认 `true`（opencode 无此字段，openagent 自定）

#### Scenario: timeout 不映射
- **WHEN** opencode 定义含 `timeout`（请求超时）
- **THEN** 适配层 SHALL NOT 将其映射为连接超时参数（语义不同），该字段忽略

### Requirement: MCP server 连接管理
系统 SHALL 基于官方 `@modelcontextprotocol/sdk`（`Client` + `StdioClientTransport`/`SSEClientTransport`/`StreamableHTTPClientTransport`）自实现连接管理，覆盖 stdio/SSE/HTTP 三 transport 的连接生命周期。单个 server 连接失败 SHALL NOT 中断其他 server 或会话创建。启动连接行为 SHALL 分两种路径：缓存命中时跳过同步连接走异步刷新（见"MCP tool 状态缓存" requirement），缓存未命中时执行同步全量连接。

#### Scenario: 启动连接所有 enabled server（缓存未命中）
- **WHEN** `createSession` 初始化 MCP 且缓存未命中（无缓存/哈希不匹配/损坏）
- **THEN** `McpManager` SHALL 对每个 `enabled:true` 的 server 同步调用 `connect` + `listTools`，成功后写入新缓存

#### Scenario: 缓存命中跳过同步连接
- **WHEN** `createSession` 初始化 MCP 且缓存命中
- **THEN** `McpManager` SHALL NOT 同步调用 `connect`，SHALL 用缓存 tool schemas 立即生成工具定义（标记 `stale:true`），SHALL 启动后台异步任务逐个连接 server

#### Scenario: 连接失败隔离
- **WHEN** 某 server `connect` 失败（ENOENT、ECONNREFUSED、超时等）
- **THEN** 该 server SHALL 置 `error` 状态并记录可读错误信息，其他 server 与会话创建 SHALL 继续；缓存命中场景下该 server 的 tool 维持 `stale` 标记

#### Scenario: remote SSE fallback
- **WHEN** `type:"remote"` 的 server 用 `streamable-http` 连接失败
- **THEN** `McpManager` SHALL 回退到 `sse` transport 重试一次（复刻 opencode 协商行为）

#### Scenario: 自动重连
- **WHEN** 已连接 server 的 transport 断开（onclose）且 `autoReconnect:true`
- **THEN** `MCPConnectionManager` SHALL 按线性退避自动重连，达 `maxReconnectAttempts` 后置 `error`

#### Scenario: 资源清理
- **WHEN** 会话结束或应用退出
- **THEN** `McpManager` SHALL 调用 `disconnectAll()` 清理所有 MCP server 连接，SHALL 取消未完成的后台刷新任务

### Requirement: MCP 工具桥接与注入
系统 SHALL 把所有 MCP server 暴露的 tool 合并包装为单个 Pi `ToolDefinition`，命名为 `mcp`（参数含 `server_name` + `tool_name` + `arguments`），通过 `createAgentSession` 的 `customTools` 注入。MCP `inputSchema`（JSON Schema）SHALL 直传为合并后 catalog 的 tool schema。tool schema 的来源 SHALL 可以是实时 `listTools` 结果或磁盘缓存（缓存命中时）。

#### Scenario: 单 mcp 工具合并命名
- **WHEN** server `github` 暴露 tool `create_issue`，server `slack` 暴露 tool `send_message`
- **THEN** 系统 SHALL 注入单个名为 `mcp` 的 Pi 工具，其参数 schema 的 `server_name` enum 为 `["github","slack"]`，agent 调用时通过 `server_name` + `tool_name` 定位具体 tool

#### Scenario: 工具执行转发
- **WHEN** LLM 调用 `mcp` 工具并传入 `server_name` + `tool_name` + `arguments`
- **THEN** `ToolDefinition.execute` SHALL 调用 `MCPConnectionManager.callTool(serverName, toolName, args)` 转发并返回结果；若目标 server 尚未连接（缓存命中场景），execute SHALL 先 await 该 server 的连接 promise

#### Scenario: 工具白名单
- **WHEN** 注入 `customTools`
- **THEN** `createAgentSession` 的 `tools` 白名单 SHALL 同时包含内置工具名与 `"mcp"`（单个合并工具名）

#### Scenario: 无工具的 server
- **WHEN** 某 server 连接成功但 `listTools` 返回空
- **THEN** 该 server SHALL NOT 出现在 `mcp` 工具的 catalog 中，SHALL NOT 报错

#### Scenario: 缓存作为 schema 来源
- **WHEN** 缓存命中且后台刷新尚未完成
- **THEN** `mcp` 工具的 catalog 与 schema SHALL 来自缓存 tool schemas，description SHALL 标记 `(stale)` 提示数据可能陈旧；后台刷新完成后 SHALL 热替换为实时数据并移除标记

### Requirement: /mcp 命令面板

`/mcp status` 命令输出 SHALL 使用状态图标替代方括号标签，并附加 server type hint。

#### Scenario: 图标映射
- **WHEN** 渲染 server 状态行
- **THEN** connected → `✓`，cached → `○`，connecting → `◌`，failed → `✗`

#### Scenario: type hint 显示
- **WHEN** server 配置的 transport type 为 streamable-http 或 sse
- **THEN** 输出 SHALL 显示 `remote` type hint
- **WHEN** server 配置的 transport type 为 stdio
- **THEN** 输出 SHALL 显示 `local` type hint

### Requirement: MCP tool 状态缓存
系统 SHALL 维护一份 MCP tool schemas 的磁盘缓存（`~/.config/openagent/mcp-tool-cache.json`），以合并后 `mcp.json` 的内容哈希为键。缓存 SHALL 存储每个 server 的完整 tool 定义（name + description + inputSchema）。缓存 SHALL NOT 存储 `client`/`transport` 等不可序列化的连接态对象。

缓存命中时（configHash 匹配），系统 SHALL 用缓存的 tool schemas 立即生成 `mcp` 工具定义，每个 server 标记 `stale:true`，随后启动后台异步任务刷新。缓存未命中（文件不存在/损坏/哈希不匹配）时，系统 SHALL 降级为同步全量连接 + listTools，并写入新缓存。

#### Scenario: 缓存写入时机
- **WHEN** `McpManager.initialize()` 完成 listTools 且至少一个 server 成功连接
- **THEN** 系统 SHALL 将每个成功 server 的完整 tool schemas 落盘到 `~/.config/openagent/mcp-tool-cache.json`，键为合并后 `mcp.json` 的 SHA-256 哈希

#### Scenario: 缓存命中跳过同步连接
- **WHEN** 启动时缓存存在且 configHash 匹配当前 `mcp.json`
- **THEN** `McpManager.initialize()` SHALL NOT 同步调用任何 server 的 `connect`/`listTools`，SHALL 直接用缓存 tool schemas 生成 `_toolDefinition`（标记 `stale:true`），SHALL 启动后台异步刷新任务

#### Scenario: 缓存未命中降级同步
- **WHEN** 缓存文件不存在、损坏（JSON 解析失败）、或 configHash 不匹配
- **THEN** 系统 SHALL 执行原有的同步全量连接 + listTools 流程，连接成功后写入新缓存

#### Scenario: configHash 失效
- **WHEN** 用户修改 `mcp.json`（新增/删除/修改 server 定义）
- **THEN** 下次启动时 configHash SHALL 不匹配旧缓存，系统 SHALL 降级为同步连接并刷新缓存

#### Scenario: 缓存文件损坏容忍
- **WHEN** 缓存文件 JSON 解析失败或结构不符合预期
- **THEN** 系统 SHALL 删除损坏文件、降级为同步连接、记录警告日志，SHALL NOT 抛出异常中断启动

#### Scenario: 后台异步刷新
- **WHEN** 缓存命中后启动后台刷新任务
- **THEN** 系统 SHALL 对每个 server 执行 `connect` + `listTools`，成功后比对 tool schemas 差异，热替换 `_toolDefinition` 中的 tool 列表、清除该 server 的 `stale` 标记、落盘更新后的缓存

#### Scenario: stale tool 调用
- **WHEN** agent 调用某标记 `stale:true` 的 tool 且该 server 连接尚未就绪
- **THEN** execute SHALL 等待该 server 的连接 promise；连接成功后正常转发调用，连接失败则返回清晰错误并标记该 server 需手动刷新

