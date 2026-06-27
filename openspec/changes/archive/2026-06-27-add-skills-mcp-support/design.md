## Context

openagent 当前 `createSession` 只注入 4 个内置工具（`tools: ["read","bash","edit","write"]`），无 MCP 支持。Pi SDK（`@earendil-works/pi-coding-agent` 0.79.x）刻意不内建 MCP（README/issue #563/package.json 三重证据），但提供两个工具扩展点：`customTools?: ToolDefinition[]`（`createAgentSession` 直接入参）与 `pi.registerTool()`（extension 运行时注册）。

调研确认（见 explore 结论）：
- Pi SDK 无 MCP client，需自建桥接。
- 官方 `@modelcontextprotocol/sdk` v1.29.0（MIT）提供 `Client` + `StdioClientTransport`/`SSEClientTransport`/`StreamableHTTPClientTransport`/`WebSocketClientTransport`，覆盖 stdio/sse/streamable-http/websocket。连接管理（生命周期、自动重连、错误分类、remote SSE fallback）由 openagent 自实现于 `McpManager`，不引入第三方封装（原拟复用 `@0xkobold/pi-mcp`，但该包在当前网络环境仅 npmmirror 可达时不可得，故弃用）。
- opencode 的 MCP 配置在 `opencode.json` 的 `mcp` 字段下，`type` 只有 `local|remote`，`remote` 运行时自动协商 StreamableHTTP→SSE。openagent 采用此格式（独立 `mcp.json` 文件，放配置文件夹）。

现有 `createSession` 返回 `{ session, skillManager }`；`SkillManager` 已通过 `DefaultResourceLoader` 注入 skills；`CommandRegistry` 已是可插拔命令表；`SettingsPanel` 是面板 UI 范例。

## Goals / Non-Goals

**Goals:**
- 启动时按 mcp.json 连接所有 enabled MCP server，把其 tools 桥接成 Pi 工具注入 agent。
- 支持 stdio/SSE/HTTP 三 transport（remote 自动协商）。
- `/mcp` 面板可视化连接状态、支持重连。
- 配置格式对齐 opencode `mcp` 字段，与 openagent 现有配置体系（`.openagent/`、`~/.config/openagent/`）一致。

**Non-Goals:**
- OAuth、WebSocket transport、MCP resources/prompts 暴露（见 proposal Non-goals）。
- 运行时动态增删 MCP server 的工具热更新（customTools 是 session 创建前静态注入；`/mcp` 面板的重连只恢复连接，新增 server 需重启 session）。

## Decisions

### 架构与数据流

```
┌─ 启动 ───────────────────────────────────────────────────────────┐
│  index.tsx                                                        │
│    ├─ loadConfig(cwd)              → Config (config.json)         │
│    ├─ loadMcpConfig(cwd)  ★NEW     → McpConfig (mcp.json)         │
│    └─ createSession({cwd, model, config, mcpConfig})  ★改签名     │
│         │                                                         │
│         ▼  src/agent/session.ts                                   │
│   ┌─────────────────────────────────────────────────────────┐    │
│   │ 1. 现有：authStorage / modelRegistry / settingsManager   │    │
│   │ 2. 现有：SkillManager.initialize → resourceLoader        │    │
│   │ 3. ★NEW McpManager.initialize(mcpConfig):                │    │
│   │      ├─ adaptToTransports(mcpConfig)       → McpServerCfg[]│    │
│   │      ├─ mcpConnMgr.connect(each) → discover tools        │    │
│   │      └─ bridgeToToolDefs(tools)   → ToolDefinition[]     │    │
│   │ 4. createAgentSession({                                  │    │
│   │      ..., resourceLoader,                                │    │
│   │      tools: [内置4 + mcp工具名...],                       │    │
│   │      customTools: mcpToolDefs,  ★注入                    │    │
│   │    })                                                    │    │
│   │ 5. return { session, skillManager, mcpManager } ★加字段  │    │
│   └─────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────┘

┌─ 配置 → 适配 → 连接 数据流 ──────────────────────────────────────┐
│                                                                  │
│  .openagent/mcp.json (+全局 deepMerge)                           │
│    { "github": {type:"local", command:["npx","-y","srv"],        │
│                 environment:{TOKEN:"..."} },                     │
│      "context7": {type:"remote", url:"https://..."} }            │
│         │  src/mcp/config.ts (loadMcpConfig, deepMerge 复用)     │
│         ▼                                                         │
│  McpConfig (Record<name, OpencodeServerDef>)                     │
│         │  src/mcp/adapter.ts (adaptOpencodeToPiMcp) ★核心层    │
│         ▼                                                         │
│  MCPServerConfig[]  (pi-mcp 原生格式)                             │
│    [{ name:"github", transport:{type:"stdio",                    │
│         command:"npx", args:["-y","srv"], env:{TOKEN:"..."}},    │
│      enabled:true, autoReconnect:true },                         │
│     { name:"context7", transport:{type:"streamable-http",        │
│         url:"https://..."}, enabled:true }]                      │
│         │  src/mcp/manager.ts (封装 MCPConnectionManager)        │
│         ▼                                                         │
│  MCPConnectionManager.connect(each) → ConnectionInfo(tools[])    │
│         │  src/mcp/tools.ts (bridgeToToolDefs)                  │
│         ▼                                                         │
│  ToolDefinition[]  命名 mcp_<server>_<tool>                      │
│    [{ name:"mcp_github_create_issue",                            │
│       parameters: <mcp inputSchema 直传>,                        │
│       execute: (_,args) => mcpConnMgr.callTool(srv,tool,args) }] │
│         │                                                         │
│         ▼  customTools 注入                                       │
│  Agent Loop → LLM 调 mcp_github_create_issue                     │
└──────────────────────────────────────────────────────────────────┘

┌─ remote transport 协商（复刻 opencode 行为）────────────────────┐
│  adapter 对 type:"remote" 生成 streamable-http，                 │
│  并在 manager.connect 失败时 fallback 到 sse 重试一次            │
│  （pi-mcp 不自带协商，由 manager 层补）                          │
└──────────────────────────────────────────────────────────────────┘
```

### 关键技术决策

| # | 决策 | 选项 | 选择 | 理由（含被否选项） |
|---|---|---|---|---|
| D1 | 工具注入路径 | `customTools` vs `pi.registerTool`(extension) | **`customTools`** | `createAgentSession` 直接入参（sdk.d.ts L48），SDK 嵌入模式原生支持。extension 路径需 `resourceLoader` 内部加载（无直接 extension 入参），SDK 模式下加载机制不明；且 extension 的动态增删能力非 MVP 必须。customTools 是静态注入，配合外部 MCPConnectionManager 管生命周期，execute 只做 callTool 转发。 |
| D2 | 连接管理实现 | 自实现 vs 复用第三方封装 | **自实现（基于官方 `@modelcontextprotocol/sdk`）** | 原拟复用 `@0xkobold/pi-mcp/client` 的 `MCPConnectionManager`，但该包在当前网络环境（仅 npmmirror 可达）不可得，且第三方封装增加维护风险。改用官方 `@modelcontextprotocol/sdk` 的 `Client` + 各 `Transport` 自实现 `McpManager`（~150 行），覆盖 connect/disconnect/reconnect/callTool/listTools + remote streamable-http→sse fallback + 线性退避重连。代价：多写连接管理代码；收益：零第三方依赖、完全可控、重连/退避逻辑可抽纯函数测试。 |
| D3 | 配置格式 | opencode `mcp` 字段 vs Claude Desktop mcpServers vs pi-mcp 原生 | **opencode `mcp` 字段** | local/remote 二分简洁；remote 自动协商省配置；与 opencode 概念一致。代价：与 Claude Desktop `.mcp.json` 不互通（需适配层）。pi-mcp 原生格式（4 transport type）对用户暴露过多实现细节。 |
| D4 | 配置文件位置 | 项目根 vs `.openagent/` 配置文件夹 | **`.openagent/mcp.json` + `~/.config/openagent/mcp.json`** | 与 openagent 现有 config.json 体系一致。代价：不与项目根 `.mcp.json`（Cursor/opencode 风格）互通，用户需手动同步（已用户确认接受）。 |
| D5 | transport 映射 | — | local→stdio；remote→streamable-http(+sse fallback) | opencode 的 local/remote 二分需翻译到 pi-mcp 的显式 type。remote 的自动协商由 manager 层补（pi-mcp 不自带）。 |
| D6 | 工具命名 | 扁平 vs 命名空间 | **`mcp_<server>_<tool>`** | issue #563 建议；避免与内置 read/bash/edit/write 冲突；面板里易识别来源。 |
| D7 | 工具暴露模式 | direct-tool vs proxy-tool | **direct-tool** | 每个 MCP tool 直接暴露给 LLM，体验好（无发现往返）。proxy 模式省 context 但 LLM 要多一轮，TUI 场景 context 充裕，选 direct。 |
| D8 | remote SSE/HTTP 协商位置 | adapter 层 vs manager 层 | **manager 层** | adapter 只做静态格式翻译（remote→streamable-http）；运行时 fallback 到 sse 是连接行为，放 manager.connect 包装层。保持 adapter 纯函数可测。 |

### 适配层映射规则（D5/D8 细化）

| opencode 字段 | → pi-mcp `MCPServerConfig` | 备注 |
|---|---|---|
| `type:"local"` | `transport.type:"stdio"` | |
| `type:"remote"` | `transport.type:"streamable-http"`（manager 层 sse fallback） | |
| `command:["npx","-y","x"]` | `transport.command:"npx"` + `transport.args:["-y","x"]` | **数组首元素拆出** |
| `environment` | `transport.env` | 字段名变 |
| `cwd` | `transport.cwd` | |
| `url`/`headers` | `transport.url`/`transport.headers` | |
| `enabled` | `enabled` | 默认 true |
| `timeout`(请求超时) | 不映射 | pi-mcp `connectTimeoutMs` 是连接超时，语义不同 |
| `oauth` | 不支持（Non-goal） | 用户须自行注入 `headers` token |
| —（opencode 无） | `autoReconnect:true` 等 | openagent 自定默认 |

## Risks / Trade-offs

- **[customTools 静态注入，无法运行时增删工具]** → MVP 接受。`/mcp` 面板的重连只恢复已有 server 连接；新增 server 需重启 session（提示用户）。后续如需热更新再评估 extension 路径。
- **[customTools 的 ToolDefinition.execute 签名在 SDK 模式下是否完整填充 ctx]** → MCP 桥接 execute 不依赖 ctx（只 callTool），即使 ctx 为空不影响。apply 阶段验证签名匹配，必要时适配。
- **[pi-mcp README 与源码不一致（构造函数 samplingHandler 第4参不存在）]** → 以源码为准（3 参），实现时不传第4参。
- **[remote SSE/HTTP fallback 自实现，行为可能与 opencode 不完全一致]** → manager 层先试 streamable-http 失败回退 sse，复刻 opencode mcp/index.ts 逻辑；集成测试覆盖两种 endpoint。
- **[自实现 connection manager 而非复用第三方]** → 因 `@0xkobold/pi-mcp` 在当前网络不可得，改用官方 `@modelcontextprotocol/sdk` 自实现。官方 SDK 是 MCP 参考实现，transport 覆盖完整；自管层仅做连接编排 + 重连 + fallback，逻辑边界清晰、可测（重连/退避抽纯函数）。
- **[MCP server 启动失败阻塞 createSession]** → McpManager.initialize 对每个 server 的 connect 失败做 try/catch，失败 server 置 error 状态（面板可见）不中断其他 server 与 session 创建。

## Open Questions

- customTools 注入的工具是否需要在 `tools` 白名单同时声明？（librarian 报告 examples 显示 `tools:[..., "my_tool"]` + `customTools:[myTool]` 并用；apply 阶段第一个任务验证，若不需要则省去白名单维护）。
