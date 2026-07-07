## 1. 缓存模块基础（src/mcp/cache.ts）

- [x] 1.1 创建 `src/mcp/cache.ts`，定义 `CacheData` 类型（`configHash: string`, `updatedAt: string`, `servers: Array<{ name, tools: Array<{ name, description, inputSchema }> }>`）+ `resolveCachePath(): string`（返回 `~/.config/openagent/mcp-tool-cache.json`）
- [x] 1.2 实现 `computeConfigHash(config): string` — 对合并后 mcp.json 配置做稳定 JSON 序列化（顶层 + 嵌套 key 递归排序）后取 SHA-256 hex
- [x] 1.3 实现 `readCache(): Promise<CacheData | null>` — try/catch 包裹，文件不存在/JSON 解析失败/结构不符时返回 null 并记录警告；`writeCache(data): Promise<void>` — mkdir -p + 写 tmp 文件 + rename 原子替换

## 2. 类型扩展（src/mcp/types.ts + manager.ts）

- [x] 2.1 定义 `ConnectionStatus = "cached" | "connecting" | "connected" | "failed"` 类型；`McpServerConnection` 改为 `client: Client | null`、`transport: Transport | null`、`status: ConnectionStatus`（替代 stale boolean，显式状态机）、`connectionPromise?: Promise<void>`、`error?: string`（D2 类型调整）
- [x] 2.2 `McpManager` 增加 `_cacheData: CacheData | null`、`_refreshTask: Promise<void> | null`、`_disposed: boolean` 字段；定义 `EXECUTE_WAIT_TIMEOUT_MS = 10_000` 常量

## 3. McpManager 缓存优先路径（src/mcp/manager.ts）

- [x] 3.1 重构 `initialize()` 开头：调用 `readMcpConfig` + `computeConfigHash` + `readCache`，比对 configHash 判断命中
- [x] 3.2 缓存命中分支：用缓存 tools 填充 `connections`（每个 server 构造占位 `McpServerConnection`，`status:"cached"`，client/transport 为 null）→ 调用 `createMcpToolDefinition` 生成 `_toolDefinition` → 启动 `_refreshTask = this.refreshAll()`（不 await）→ 立即返回
- [x] 3.3 缓存未命中分支：保持现有 `Promise.allSettled` 同步连接 + listTools 路径，成功后构造 `writeCache()` 落盘；连接成功的 server `status:"connected"`

## 4. 后台刷新、execute 等待与并发安全（src/mcp/manager.ts）

- [x] 4.1 实现 `refreshServer(name: string): Promise<void>`（D8 并发锁）— 开头检查 `connections[i].status`：`connecting` 则 `await conn.connectionPromise` 后返回（不重新 connect）；`connected` 强制重连（置回 connecting）；`cached`/`failed` 执行 connect。connect + listTools（复用 `connectServer`/`connectWithTransport` 含 5s 超时）→ 成功置 `status:"connected"` + 热替换 tools + resolve connectionPromise + `rebuildToolDefinition()` + 增量 `writeCache()`；失败置 `status:"failed"` + reject connectionPromise
- [x] 4.2 实现 `refreshAll(): Promise<void>` — 对所有 `connections` 并行 `refreshServer`，每个独立 try/catch（失败置 failed），整体 `.catch(console.error)` 兜底；每步检查 `_disposed` 则中途退出
- [x] 4.3 修改 `executeTool`（manager.ts，D4 超时 + D7 null 防护）— 开头检查 `conn.status`，非 `connected` 则 `await Promise.race([conn.connectionPromise, timeout(EXECUTE_WAIT_TIMEOUT_MS)])`；await 后仍非 connected 或 client 为 null 返回清晰错误（含 `/mcp refresh` 提示）；校验 `tool_name` 在实时 tools 中；注意 bridge.ts 的 execute 调用 `executeFn` 即此方法，改 manager.ts 一处即可
- [x] 4.4 null 安全防护（D7）— `dispose()` 对每个 connection `if (conn.transport) await conn.transport.close()` 跳过 null transport；`getAuthorizedToolDefinition` 传含 cached 项的 connections 给 `createMcpToolDefinition`（catalog 只读 name+tools 安全）；`dispose()` 置 `_disposed = true`，后台任务检查后跳过热替换

## 5. 公开 API 与命令接入

- [x] 5.1 实现 `McpManager.refreshTools(serverName?: string): Promise<{success: number, failed: number}>`（D8）— 无参：若 `_refreshTask` 存在且未完成先 `await`，再调用 `refreshAll`；有参：校验 server 名后调用 `refreshServer`（内部 status 锁生效）；返回结果摘要
- [x] 5.2 `src/commands/registry.ts` `CommandContext` 增加 `mcpManager?: McpManager` 字段（D5）；`src/agent/session.ts` `initServices` 或 `src/server/index.ts` 构造命令上下文时注入 mcpManager
- [x] 5.3 `src/tui/commands.ts` 改造 `/mcp` handler 为子命令分发（D6，参考 `/team` L463-600 模式）：解析首个 token，空 → 现有打开面板行为（保持不变），`refresh [server]` → 调用 `mcpManager.refreshTools(args)` 后显示摘要 toast，`status` → 显示 configHash 命中/各 server status/stale 数/缓存路径，未知 token → 用法提示

## 6. 测试与验证

- [x] 6.1 创建 `tests/mcp-cache.test.ts`：① `computeConfigHash` 稳定性（同配置不同 key 顺序 → 同哈希）② `writeCache` + `readCache` 往返一致 ③ `readCache` 损坏文件容忍（写入非法 JSON → 返回 null + 文件被删除）
- [x] 6.2 运行 `bun run check`（typecheck + lint + test）全绿，无新增 `any` 警告
- [x] 6.3 确认 spec delta 的 MODIFIED "MCP 工具桥接与注入" requirement 已修正为单 `mcp` 工具命名（spec debt 修正），归档时 `openspec archive` 将自动同步到 `openspec/specs/mcp/spec.md`
