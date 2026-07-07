## Why

MCP server 连接是 openagent 启动延迟的主要来源：`McpManager.initialize()` 对每个 `enabled:true` 的 server 执行 `connect`（5s 超时）+ `listTools()`，多 server 通过 `Promise.allSettled` 并行但总体仍受最慢者拖累。对于配置稳定的开发环境，MCP tool 集合很少变化，每次冷启动都重新连接+枚举是浪费。

引入 tool 状态缓存层后：缓存命中时（`mcp.json` 内容哈希匹配）启动跳过同步连接，直接用缓存的 tool schemas 注册 `mcp` 工具（标记 stale），agent 立即可用；后台异步任务再连接 server + `listTools` 刷新，完成后热更新工具定义并落盘。这把"MCP 就绪"从启动阻塞路径移到后台，显著降低首字延迟。

## What Changes

- **新增缓存层**：首次成功 `connect` + `listTools` 后，将每个 server 的完整 tool schemas（name + description + inputSchema）落盘到 `~/.config/openagent/mcp-tool-cache.json`，键为合并后 `mcp.json` 的内容哈希。
- **缓存优先启动路径**：`McpManager.initialize()` 开头读缓存；命中则跳过同步连接，直接用缓存 tool schemas 生成 `_toolDefinition`（每个 server 标记 `stale:true`），随后启动后台异步刷新任务。
- **后台异步刷新**：缓存命中后启动一次后台任务，对每个 server 执行 `connect` + `listTools`；成功后比对差异，热替换 `_toolDefinition` 中的 tool 列表、清除 `stale` 标记、落盘新缓存。任务生命周期挂在 `AgentServer`/`McpManager` 上，进程退出时清理。
- **失配容忍**：实际 server 已不提供缓存中的某 tool，或该 server 连接失败时，保留该 tool 但维持/置 `stale` 标记；agent 调用 stale tool 时 execute 等待该 server 的连接 promise，连接就绪后正常转发，连接失败则返回清晰错误。
- **`/mcp` 命令扩展为子命令模式**：`/mcp`（无参）保持现有行为打开 `McpPanel`；新增 `/mcp refresh [server]` 强制重新连接并刷新全部或指定 server 的缓存；新增 `/mcp status` 显示缓存命中情况、各 server 连接状态、stale tool 数量。
- **修正 spec debt**：现有 spec 的"MCP 工具桥接与注入" requirement 描述 `mcp_<server>_<tool>` 多工具命名，但代码已合并为单个 `mcp` 工具（参数含 `server_name` + `tool_name` + `arguments`）。同步 spec 以反映现实，并补充缓存作为工具 schema 来源。

## Non-goals

- 不引入定期轮询/心跳机制（启动后台异步刷新一次即可，不增加 `src/poll/` 复杂度）。
- 不改变 `mcp.json` 配置格式或读取逻辑（`src/mcp/config.ts` 保持不变）。
- 不改变 Pi SDK 工具注册双名单机制（`customTools` + `tools` 白名单双写）。
- 不缓存 `client`/`transport` 连接对象（不可序列化，每次执行 tool 仍需实际连接）。
- 不实现缓存淘汰/TTL 过期策略（仅靠 `mcp.json` 哈希失效 + `/mcp refresh` 手动刷新）。
- 不修改 `McpPanel` 面板 UI（仅扩展命令层，面板内的重连按钮逻辑复用新的 refresh 能力）。
- 不为远程 server 做乐观更新（远程 tool 集合可能动态，stale 标记必须明确）。

## Capabilities

### New Capabilities

（无 — 所有变更都在现有 `mcp` capability 范围内）

### Modified Capabilities

- `mcp`: 
  - **连接管理** requirement 增加"缓存优先启动 + 后台异步刷新"路径，原同步全量连接降级为缓存未命中时的 fallback。
  - **工具桥接与注入** requirement 修正为反映单 `mcp` 工具现实（合并 schema），并补充缓存作为 tool schema 来源、stale 标记语义。
  - **`/mcp` 命令面板** requirement 扩展为子命令模式：无参打开面板（行为不变），`refresh [server]` 刷新缓存+连接，`status` 查看缓存与连接状态。

## Impact

- **代码变更**：
  - `src/mcp/manager.ts`: `initialize()` 拆分为缓存优先路径 + 异步刷新；新增 `refreshTools(serverName?)` 公开方法供命令调用；`McpServerConnection` 扩展 `stale` 标记。
  - `src/mcp/cache.ts`（新文件）: 缓存读写、`configHash` 计算、缓存文件路径解析（复用 `~/.config/openagent/` 目录约定）。
  - `src/mcp/bridge.ts`: `createMcpToolDefinition` 支持 stale 标记透传到 description；execute 路径等待目标 server 的连接 promise。
  - `src/mcp/types.ts`: `McpServerConnection` 增加 `stale: boolean` + `connectionPromise?: Promise`。
  - `src/tui/commands.ts`: `/mcp` 命令 handler 改为子命令分发（参考现有 `/team` 子命令模式）。
  - `src/commands/registry.ts`: `CommandContext` 扩展 `mcpManager` 引用。
  - `src/agent/session.ts` `initServices`: 将 `mcpManager` 注入 `CommandContext`。
  - `src/server/index.ts`: `AgentServer` 暴露 `mcpManager` 给命令层。
- **依赖**: 无新增（复用现有 `@modelcontextprotocol/sdk` + Node 内置 `crypto`/`fs`）。
- **配置**: 缓存文件 `~/.config/openagent/mcp-tool-cache.json` 自动管理，用户无需配置；不进 `config.json`。
- **测试**: `tests/mcp-cache.test.ts` 覆盖 configHash 稳定性、缓存读写往返、损坏降级、命中/未命中分支。
- **向后兼容**: 缓存不存在/损坏/哈希不匹配时降级为现有同步全量连接行为，无破坏性变更；现有 `/mcp` 无参行为保持不变。
