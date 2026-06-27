## Why

openagent 目前只能用内置 4 个工具（read/bash/edit/write），无法接入外部 MCP server 暴露的工具生态。用户无法复用已有的 MCP server（filesystem、github、context7 等），每次都要让 LLM 用 bash 绕路，效率低且不可靠。Pi SDK 刻意不内建 MCP，但提供了 `customTools`/`pi.registerTool` 扩展点，桥接层很薄——现在加 MCP 支持，让 openagent 真正融入 MCP 生态。

## What Changes

1. **MCP 配置**：新增独立 `mcp.json` 配置文件（`~/.config/openagent/mcp.json` 全局 + `.openagent/mcp.json` 项目，deepMerge 合并），格式对齐 opencode 的 `mcp` 字段（`type: local|remote`，`command` 合并数组，`environment`；`remote` 运行时自动协商 StreamableHTTP/SSE）。`config.json` 不含 mcp 字段，配置源单一。
2. **MCP 连接管理**：基于官方 `@modelcontextprotocol/sdk` 的 `Client` + `StdioClientTransport`/`SSEClientTransport`/`StreamableHTTPClientTransport` 自实现 `McpManager`，管理 stdio/SSE/HTTP 三种 transport 的连接生命周期（连接、自动重连、超时、错误分类）。新增 opencode 配置 → 内部 transport 配置适配层（`command` 数组拆分、`environment→env`、`local→stdio`、`remote→streamable-http` + SSE fallback）。
3. **MCP 工具桥接与注入**：每个 MCP server 暴露的 tool 包装成 Pi `ToolDefinition`（命名空间 `mcp_<server>_<tool>`，direct-tool 模式），通过 `customTools` 或 `pi.registerTool` 注入 agent session。MCP `inputSchema`（JSON Schema）直接喂给 Pi 的 TypeBox parameters。
4. **`/mcp` 命令**：新增 `/mcp` 命令打开交互面板，展示各 server 连接状态（connected/error/disconnected）、工具数量、错误信息，支持重连/启停操作。

## Capabilities

### New Capabilities

- `mcp`: MCP server 接入能力——配置读取（opencode 格式 mcp.json）、opencode→pi-mcp 适配、连接生命周期管理（stdio/SSE/HTTP 三 transport，复用 MCPConnectionManager）、MCP tool→Pi ToolDefinition 桥接与注入、`/mcp` 命令面板。

### Modified Capabilities

- `agent-session`: `createSession` 增加 MCP 初始化——读 mcp.json 配置、起 MCPConnectionManager 连接所有 enabled server、把发现的 MCP tools 包装注入 agent session（customTools 或 registerTool），返回 `mcpManager` 供 UI 使用。
- `cli-entry`: 启动流程加载 mcp.json（独立于 config.json），传入 createSession。
- `tui-input`: 新增 `/mcp` 命令注册。

## Non-goals

- **OAuth 鉴权**：pi-mcp 的 `MCPConnectionManager` 不支持 OAuth；需要鉴权的 remote server 用户须自行在 `headers` 注入 token。后续可单独评估。
- **WebSocket transport**：pi-mcp 支持但 MVP 不暴露，stdio/SSE/HTTP 已覆盖主流场景。
- **MCP resources / prompts 暴露**：pi-mcp 支持 `readResource`/`getPrompt`，但 MVP 只桥接 tools（LLM 调用主体），resources/prompts 留后续。
- **项目根 `.mcp.json` 兼容读取**：配置源单一，只读 `.openagent/mcp.json` + 全局，不 fallback 到项目根 opencode/Cursor 风格位置。
- **config.json 内嵌 mcp 配置**：mcp 配置完全独立到 mcp.json，config.json 不加 mcp 字段。

## Impact

- **新增依赖**：`@modelcontextprotocol/sdk ^1.29.0`（MIT，MCP 官方参考实现，提供 `Client` + 各 `Transport`）；peer 依赖 `@sinclair/typebox`（Pi SDK 已带）。
- **新增文件**：`src/mcp/`（config.ts 读 mcp.json、adapter.ts opencode→内部 transport 配置、manager.ts 自实现 McpManager、tools.ts MCP tool→ToolDefinition 桥接）、`src/tui/components/McpPanel.tsx`。
- **修改文件**：`src/agent/session.ts`（MCP 初始化 + 工具注入 + 返回 mcpManager）、`src/index.tsx`（加载 mcp.json 传入）、`src/tui/commands.ts`（注册 `/mcp`）、`src/tui/App.tsx`（MCP 面板状态 + 传 mcpManager）、`src/commands/registry.ts`（CommandContext 加 mcpManager 字段）。
- **测试**：新增 `tests/mcp/`（config 解析、adapter 转换、工具桥接的纯函数测试）；连接管理因含进程/网络副作用，抽可注入接口测纯逻辑。
- **风险**：注入路径（customTools vs pi.registerTool）取决于 SDK 嵌入模式下 extension API 可用性，design 阶段读 `sdk.d.ts` 确认，不可用则回退 customTools + 自管生命周期。
