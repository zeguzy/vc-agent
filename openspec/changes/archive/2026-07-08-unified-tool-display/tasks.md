# Implementation Tasks

## 1. InputBox MCP 指示器（App 层派生）

- [ ] 1.1 在 `src/tui/App.tsx` 注册 poll task `"mcp-status"`：调用 `mcpManager?.getConnectionStatus()`，返回 primitive string key `"${total}:${hasFailed}"`（确保 PollManager 变更检测有效）
- [ ] 1.2 InputBox 新增 `mcpStatus?: { total: number; hasFailed: boolean }` prop（不接收 mcpManager）
- [ ] 1.3 在状态行 branch 之后追加 `⊙ N MCP`（绿色=无 failed，红色=有 failed），0 server 或 mcpStatus undefined 时不渲染

## 2. App.tsx 透传 mcpStatus

- [ ] 2.1 在 `src/tui/App.tsx` 用 `usePollState` 读取 `"mcp-status"`，解析为 `{ total, hasFailed }`，传入 `<InputBox mcpStatus={...} />`

## 3. /tools 统一命令

- [ ] 3.1 在 `src/tui/commands.ts` 注册 `tools` 命令，handler 从 ctx 获取 agentMode + mcpManager
- [ ] 3.2 渲染 Tools 段：调用 `activeToolsFor(agentMode)` 获取活跃工具列表，空格分隔输出
- [ ] 3.3 渲染 MCP Servers 段：遍历 `mcpManager.getConnectionStatus()`，每行 `✓/✗/○/◌ {name}  {toolCount} tools  {type}`。mcpManager undefined 时显示 "No MCP servers configured"
- [ ] 3.4 渲染底部汇总行：`{total} servers · {connected} connected · {failed} failed`
- [ ] 3.5 提取 MCP_STATUS_ICONS const map（connected→✓, cached→○, connecting→◌, failed→✗）

## 4. /mcp status 风格对齐

- [ ] 4.1 修改 `src/tui/commands.ts` 的 `/mcp status` handler，将 `[connected]` → `✓`、`[cached]` → `○`、`[connecting]` → `◌`、`[failed]` → `✗`
- [ ] 4.2 附加 type hint（remote/local）：从 mcpManager 的 server config 或 getCacheInfo 获取 transport type
- [ ] 4.3 cached 状态附加 `(background refresh)` 提示

## 5. formatToolDetail 扩展

- [ ] 5.1 提取 `formatMcpArgs(args)` 独立函数（SENSITIVE_KEYS 正则过滤 + 从 `args.arguments` 提取 + 非原始值跳过 + value 截断 50 字符）
- [ ] 5.2 在 `formatToolDetail()` 新增 `case "mcp"`：调用 `formatMcpArgs(a)` → label=`{server} · {tool}`, lines=前3个原始 kv
- [ ] 5.3 新增 `case "glob"`：提取 pattern + path
- [ ] 5.4 新增 `case "webfetch"`：提取 url
- [ ] 5.5 新增 `case "question"`：提取各 question 的 header
- [ ] 5.6 新增 `case "todo"`：提取 action
- [ ] 5.7 新增 `case "notify"`：提取 title

## 6. 测试 + 验证

- [ ] 6.1 新建 `tests/unified-tool-display.test.ts`：测 MCP status 图标映射函数、formatToolDetail 的 mcp/glob/webfetch cases
- [ ] 6.2 运行 `bun run check`（typecheck + lint + test）确认全绿
