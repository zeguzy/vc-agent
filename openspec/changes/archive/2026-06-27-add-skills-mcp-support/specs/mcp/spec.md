# mcp Specification

## Purpose
定义 MCP (Model Context Protocol) server 接入能力：独立 mcp.json 配置读取（对齐 opencode 格式）、opencode→pi-mcp 适配层、连接生命周期管理（stdio/SSE/HTTP）、MCP 工具到 Pi 工具的桥接注入、`/mcp` 连接状态面板。

## ADDED Requirements

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
系统 SHALL 基于官方 `@modelcontextprotocol/sdk`（`Client` + `StdioClientTransport`/`SSEClientTransport`/`StreamableHTTPClientTransport`）自实现连接管理，覆盖 stdio/SSE/HTTP 三 transport 的连接生命周期。单个 server 连接失败 SHALL NOT 中断其他 server 或会话创建。

#### Scenario: 启动连接所有 enabled server
- **WHEN** `createSession` 初始化 MCP
- **THEN** `McpManager` SHALL 对每个 `enabled:true` 的 server 调用 `MCPConnectionManager.connect`

#### Scenario: 连接失败隔离
- **WHEN** 某 server `connect` 失败（ENOENT、ECONNREFUSED、超时等）
- **THEN** 该 server SHALL 置 `error` 状态并记录可读错误信息，其他 server 与会话创建 SHALL 继续

#### Scenario: remote SSE fallback
- **WHEN** `type:"remote"` 的 server 用 `streamable-http` 连接失败
- **THEN** `McpManager` SHALL 回退到 `sse` transport 重试一次（复刻 opencode 协商行为）

#### Scenario: 自动重连
- **WHEN** 已连接 server 的 transport 断开（onclose）且 `autoReconnect:true`
- **THEN** `MCPConnectionManager` SHALL 按线性退避自动重连，达 `maxReconnectAttempts` 后置 `error`

#### Scenario: 资源清理
- **WHEN** 会话结束或应用退出
- **THEN** `McpManager` SHALL 调用 `disconnectAll()` 清理所有 MCP server 连接

### Requirement: MCP 工具桥接与注入
系统 SHALL 把每个 MCP server 暴露的 tool 包装成 Pi `ToolDefinition`（direct-tool 模式，命名 `mcp_<server>_<tool>`），通过 `createAgentSession` 的 `customTools` 注入。MCP `inputSchema`（JSON Schema）SHALL 直传为 `ToolDefinition.parameters`。

#### Scenario: 工具命名空间
- **WHEN** server `github` 暴露 tool `create_issue`
- **THEN** Pi 工具名 SHALL 为 `mcp_github_create_issue`

#### Scenario: 工具执行转发
- **WHEN** LLM 调用某 `mcp_*` 工具
- **THEN** `ToolDefinition.execute` SHALL 调用 `MCPConnectionManager.callTool(serverName, toolName, args)` 转发并返回结果

#### Scenario: 工具白名单
- **WHEN** 注入 `customTools`
- **THEN** `createAgentSession` 的 `tools` 白名单 SHALL 同时包含内置 4 工具名与所有 `mcp_*` 工具名（若 SDK 要求）

#### Scenario: 无工具的 server
- **WHEN** 某 server 连接成功但 `listTools` 返回空
- **THEN** 该 server SHALL NOT 产生任何 Pi 工具，SHALL NOT 报错

### Requirement: /mcp 命令面板
系统 SHALL 提供 `/mcp` 命令打开交互面板，可视化 MCP server 连接状态。

#### Scenario: 打开面板
- **WHEN** 用户执行 `/mcp`
- **THEN** 系统 SHALL 打开 `McpPanel`（实现风格参照现有 `SettingsPanel`），显示所有已配置 server

#### Scenario: 状态展示
- **WHEN** 渲染 `McpPanel`
- **THEN** 每个 server SHALL 显示名称、transport 类型、连接状态（`connected`/`error`/`disconnected`）、工具数量；`error` 状态 SHALL 显示可读错误信息

#### Scenario: 重连操作
- **WHEN** 用户在面板对 `error`/`disconnected` 的 server 触发重连
- **THEN** 系统 SHALL 调用 `MCPConnectionManager` 重新连接并刷新面板状态

#### Scenario: 关闭面板返回
- **WHEN** 用户在面板按 Esc
- **THEN** 系统 SHALL 关闭面板返回主消息视图
