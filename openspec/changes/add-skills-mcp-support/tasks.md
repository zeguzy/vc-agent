# Tasks — add-skills-mcp-support

按依赖顺序排列。每项 ≤ 2h。每组完成后跑 `bun run check`。

## 1. 依赖与脚手架

- [x] 1.1 `@modelcontextprotocol/sdk` 已装入（^1.29.0，npmmirror）；验证 `import { Client } from "@modelcontextprotocol/sdk/client/"` 及 `StdioClientTransport`/`SSEClientTransport`/`StreamableHTTPClientTransport` 可解析（注：`@0xkobold/pi-mcp` 因当前网络不可得，方案 B 自实现）
- [x] 1.2 新建 `src/mcp/` 目录，占位 `config.ts`、`adapter.ts`、`manager.ts`、`tools.ts`（空导出），让后续任务可独立提交

## 2. 配置层（纯函数，优先测）

- [x] 2.1 实现 `loadMcpConfig(cwd)` in `src/mcp/config.ts`：读 `~/.config/openagent/mcp.json` + `.openagent/mcp.json`，复用 `src/config.ts` 的 `deepMerge`，返回 `Record<string, OpencodeServerDef>`；两文件均无则返回 `{}`
- [x] 2.2 实现 `adaptToTransports(config): McpServerConfig[]` in `src/mcp/adapter.ts`：`local→stdio`（`command` 数组首元素拆 `command`+`args`，`environment→env`）、`remote→streamable-http`、`enabled`/`autoReconnect` 默认 `true`、`timeout` 不映射
- [x] 2.3 `tests/mcp/config.test.ts` + `tests/mcp/adapter.test.ts`：覆盖全局/项目/合并/缺失、local/remote 转换、命令拆分、字段名映射、默认值（纯函数，无 IO 依赖部分用临时目录或注入）

## 3. 连接管理

- [x] 3.1 实现 `McpManager` in `src/mcp/manager.ts`：基于 `@modelcontextprotocol/sdk` 的 `Client` + 各 Transport 自管连接。`initialize(config)` 对每个 enabled server 用对应 transport 创建 Client 并 `connect`（单 server 失败 try/catch 不中断），`remote` streamable-http 失败回退 `sse` 一次；暴露 `getAllStatus()`、`reconnect(name)`、`callTool`、`listTools`、`disconnectAll`；重连退避抽纯函数便于测试
- [x] 3.2 验证 customTools 注入路径：读 `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts` 确认 `ToolDefinition.execute` 签名；最小 spike 构造一个假 ToolDefinition 传 `customTools` 跑 `createAgentSession`，确认工具可被调用 + 是否需同时加入 `tools` 白名单。结论写入 design.md Open Questions 或代码注释

## 4. 工具桥接

- [x] 4.1 实现 `bridgeToToolDefs(manager): ToolDefinition[]` in `src/mcp/tools.ts`：遍历 `manager` 各 server 的 discovered tools，命名 `mcp_<server>_<tool>`，`parameters` 直传 MCP `inputSchema`，`execute` 调用 `manager.callTool(server, tool, args)`
- [x] 4.2 `tests/mcp/tools.test.ts`：用 mock manager（固定 tools 列表 + 假 callTool）验证命名、参数透传、execute 转发（纯逻辑测试）

## 5. session 集成

- [x] 5.1 改 `createSession` in `src/agent/session.ts`：入参加 `mcpConfig?`；SkillManager 初始化后实例化 `McpManager`，`initialize` → `bridgeToToolDefs` → 把结果并入 `customTools` 传 `createAgentSession`；返回值改 `{ session, skillManager, mcpManager }`；`mcpConfig` 为空时 `mcpManager` 为 no-op 占位
- [x] 5.2 改 `src/index.tsx`：`main()` 调 `loadMcpConfig(cwd)`，传入 `createSession({ cwd, model, config, mcpConfig })`；`mcp.json` 缺失不阻塞

## 6. /mcp 命令与面板

- [x] 6.1 `src/commands/registry.ts` 的 `CommandContext` 加 `mcpManager` 字段；`src/tui/commands.ts` 注册 `/mcp` 命令（handler 触发 App view 切换）；`/help` 自动包含（动态遍历已有）
- [x] 6.2 实现 `McpPanel` in `src/tui/components/McpPanel.tsx`（参照 `SettingsPanel` 风格）：列出 server（名称/transport/状态/工具数/error 信息）、重连操作、Esc 关闭
- [x] 6.3 `src/tui/App.tsx`：加 mcp 面板 view 状态、传 `mcpManager` 给 `CommandContext`、渲染 `McpPanel`

## 7. 全检与 e2e

- [x] 7.1 `bun run check`（typecheck && lint && test）全绿，修复本次引入的所有告警/错误
- [ ] 7.2 手动 e2e：在 `.openagent/mcp.json` 配一个 stdio server（如 `@modelcontextprotocol/server-filesystem`），`bun run dev` 启动，确认 `/mcp` 显示 connected、`mcp_*_read_file` 等工具能被 LLM 调用；测一个 remote server 确认 SSE/HTTP 协商
