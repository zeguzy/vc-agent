## Context

openagent 启动时通过 `McpManager.initialize()`（`src/mcp/manager.ts` L27-62）加载 MCP：读 `mcp.json` → `Promise.allSettled` 并行 `connect`（5s 超时）→ `listTools` → 合并为单个 `mcp` 工具定义。这是启动阻塞路径，N 个 server 的延迟 = max(各 server connect + listTools)。对于 tool 集合稳定的开发环境，每次冷启动重连是浪费。

现有代码结构：
- `src/mcp/manager.ts`: McpManager（连接管理 + tool 定义生成 + executeTool L92 直接访问 conn.client）
- `src/mcp/bridge.ts`: createMcpToolDefinition（合并 catalog + schema + execute，execute 调用 executeFn 即 manager.executeTool）
- `src/mcp/config.ts`: readMcpConfig（mcp.json 读取，独立于 config.json）
- `src/mcp/types.ts`: McpServerConnection = `{ name, client, transport, tools }`
- 三处使用：`initServices`（创建）、`createRuntime` factory（取定义）、`handleSetAgentMode`（切白名单）
- `src/tui/commands.ts`: 内建命令注册（`/mcp` 当前是面板开关）
- `src/commands/registry.ts`: CommandContext（无 mcpManager 引用）

约束：
- `client`/`transport` 不可序列化 → 缓存只能存 `tools` 数组
- Pi SDK 双名单机制不变（customTools + tools 白名单）
- 不引入新依赖、不引入轮询模块

## Goals / Non-Goals

**Goals:**
- 缓存命中时把 MCP 就绪移出启动阻塞路径，agent 立即可用
- 后台异步刷新保持 tool 数据新鲜，对用户透明
- 失配容忍：连接抖动不让 tool 闪烁
- 提供 `/mcp refresh` / `/mcp status` 手动控制
- 向后兼容：无缓存时降级为现有同步行为

**Non-Goals:**
- 定期轮询/心跳（用户已否决）
- 缓存 TTL/淘汰策略
- 缓存 client/transport 对象
- 修改 mcp.json 格式
- 修改 McpPanel UI（仅命令层扩展）

## Decisions

### D1: 缓存键 = 合并后 mcp.json 的 SHA-256

**选择**: 对 `readMcpConfig()` 返回的合并后配置对象做稳定 JSON 序列化（key 排序），取 SHA-256 hex 作为缓存键。

**理由**: mcp.json 是 server 集合的唯一真实来源，任何 server 增删改都会反映在合并配置上。SHA-256 碰撞可忽略。key 排序序列化保证配置语义不变时哈希稳定。

**替代方案**:
- 文件 mtime：粗粒度，`touch` 也会触发失效，且全局+项目两个文件的 mtime 需合并判断。
- 单独的 version 字段：要求用户手动维护，易遗忘。
- 逐 server 配置指纹：粒度更细（只刷新变化的 server），但复杂度高，MVP 不需要。

### D2: 缓存只存 tools 数组 + McpServerConnection 类型调整

**选择**: 缓存结构：
```
{
  configHash: string,           // SHA-256 of merged mcp.json
  updatedAt: string,            // ISO timestamp
  servers: Array<{
    name: string,
    tools: Array<{              // MCP Tool 对象的完整序列化
      name: string,
      description: string,
      inputSchema: object       // JSON Schema
    }>
  }>
}
```

**McpServerConnection 类型调整**（Oracle 评审 #1/#4 要求）：缓存命中时占位 connection 的 `client`/`transport` 为 null，类型扩展为 nullable + 显式状态枚举（替代 `stale: boolean`，降低隐式状态机认知负担）：
```
type ConnectionStatus = "cached" | "connecting" | "connected" | "failed";

interface McpServerConnection {
    name: string;
    client: Client | null;            // null when status === "cached" | "connecting"
    transport: Transport | null;      // null when status === "cached" | "connecting"
    tools: Tool[];
    status: ConnectionStatus;         // 显式状态机
    connectionPromise?: Promise<void>; // connecting 时存在，供 execute await
    error?: string;                   // status === "failed" 时的可读错误
}
```
状态转换：`cached`（占位）→ `connecting`（refreshServer 开始）→ `connected`（成功）| `failed`（失败）。

**理由**: `client`/`transport` 是有状态的网络/进程对象，不可序列化。缓存命中时仍需建立实际连接才能执行 tool，因此缓存的价值在于"跳过同步 listTools 的等待"，而非"完全免连接"。显式 `ConnectionStatus` 让 4 种状态转换可见，优于 `stale: boolean` + promise 存在性的隐式推断。

**替代方案**:
- 缓存完整连接（含重连参数）：MCP server 是外部进程/远程服务，无法"恢复"连接态，必须重新 connect。
- 只存 tool 名：agent 拿不到参数 schema 无法正确调用，失去加速意义。
- 用 `stale: boolean` 隐式状态：4 种隐式状态靠 stale + promise 存在性推断，维护者需读代码才能理解，显式枚举更优。

### D3: 缓存命中 → 立即注册 stale 工具 → 后台异步刷新

**选择**: 缓存命中时，`initialize()` 同步生成 `_toolDefinition`（标记 stale），立即返回；随后启动后台 promise（不 await）逐个 connect + listTools；每个 server 完成后热替换其 tool 列表、清除 stale、必要时落盘。

**数据流**:
```
启动 initialize()
    │
    ▼
读 mcp.json + 计算 configHash
    │
    ▼
读 mcp-tool-cache.json ────── 命中？─── 否 ──→ 同步全量 connect+listTools（现有路径）
    │                                         │
    是                                        ▼
    │                                    写新缓存 → 返回
    ▼
用缓存 tools 填充 connections (status:"cached")
    │
    ▼
生成 _toolDefinition（catalog 含 cached server）
    │
    ▼
返回 initialize()（agent 立即可用）
    │
    ▼（后台，不阻塞）
对每个 server: cached → connecting → connect+listTools
    │                            │
    │                            ├─ 成功 → connected + 热替换 tools + 落盘
    │                            └─ 失败 → failed + 维持 cached tools
    ▼
全部完成（_toolDefinition 引用更新，但 Pi SDK 已注册 schema 不变，见 D9）
```

**理由**: 这把"MCP 就绪"从启动阻塞路径移到后台。agent 首字延迟不再受 MCP server 连接速度影响。stale 标记让用户/agent 知道数据可能陈旧。

**替代方案**:
- 缓存命中但仍同步 connect（只跳过 listTools）：connect 本身就是主要延迟源（stdio 启动进程/远程握手），加速有限。
- 缓存命中完全不连，execute 时才按需连接：首次调用体验差（等待 connect），且无法批量预热。

### D4: execute 时 await 连接 promise（带超时兜底）

**选择**: `mcp` 工具的 execute（即 `manager.executeTool`）在转发前检查目标 server 的 `status`；若非 `connected`（缓存命中后刷新未完成），`await Promise.race([conn.connectionPromise, timeout(EXECUTE_WAIT_TIMEOUT_MS)])`，再转发。超时时间 10s（大于 `connectServer` 的 5s `CONNECT_TIMEOUT_MS`，正常路径不触发；仅防 server hang 导致永久阻塞）。

```
agent 调用 mcp(server_name=X, tool_name=Y, args)
    │
    ▼
查 connections[X].status
    │
    ├─ connected ──→ 直接 callTool(X, Y, args) → 返回
    │
    └─ cached / connecting / failed
        │
        ▼
    await Promise.race([conn.connectionPromise, timeout(10s)])
        │
        ├─ resolve（连接成功）──→ 校验 Y 是否在实时 tools 中 → callTool → 返回
        │
        ├─ reject（连接失败）──→ 返回错误："server X 连接失败，请运行 /mcp refresh X"
        │
        └─ timeout（10s）──→ 返回错误："server X 连接超时，请运行 /mcp refresh X"
```

**理由**: 用户调用 stale tool 时，连接很可能已在后台进行中，await 通常只等很短时间。若连接失败，返回清晰错误而非崩溃。超时兜底防止 server hang 导致 execute 永久阻塞。

**替代方案**:
- 直接拒绝 stale 调用：用户体验差，明明工具存在却不能用。
- 阻塞 initialize 直到连接完成：回到同步阻塞路径，失去缓存意义。
- 无超时 await：依赖 connectServer 的 5s 超时，但若 connectionPromise 因异常未正确 reject，会永久阻塞；Promise.race 是防御性兜底。

### D5: CommandContext 扩展 mcpManager 引用

**选择**: 在 `CommandContext`（`src/commands/registry.ts`）增加 `mcpManager?: McpManager` 字段；`initServices` 或 `AgentServer` 构造时注入。

**理由**: `/mcp refresh` 和 `/mcp status` 需要访问 `McpManager.refreshTools()` 和连接状态。直接注入比通过 `client` 代理更清晰、类型安全。

**替代方案**:
- 通过 client 间接访问：需要在 AgentClient 上加代理方法，污染 client 接口。
- 命令内自行 new McpManager：破坏单例，状态不一致。

### D6: `/mcp` 子命令分发（参考 `/team` 模式）

**选择**: `/mcp` handler 解析首个 token：空 → 打开面板（现有行为）；`refresh` → 刷新子命令；`status` → 状态子命令。未知 token → 提示用法。

**理由**: 复用现有 `/team` 子命令分发模式（`src/tui/commands.ts` L463-600），保持命令系统一致性。无参行为不变保证向后兼容。

### D7: null client/transport 安全防护（Oracle 必须建议 #1）

**选择**: 缓存命中时占位 connection 的 `client`/`transport` 为 null（见 D2 类型调整）。现有 3 处直接访问会 TypeError 崩溃，全部加防护：
- `executeTool`（manager.ts L92）：开头检查 `conn.status`，非 `connected` 则走 D4 的 `Promise.race` await 路径；await 后 `status` 仍非 `connected` 返回错误（不访问 `conn.client`）
- `dispose`（manager.ts L111）：`if (conn.transport) await conn.transport.close()`，跳过 null transport
- `getAuthorizedToolDefinition`（manager.ts L69）：传含 cached 项的 connections 给 `createMcpToolDefinition` 是安全的（catalog 只读 name+tools），execute 路径已由 executeTool 防护覆盖

**理由**: 占位 connection 的 client/transport 为 null，现有 3 处直接访问 `conn.client`/`conn.transport` 会 TypeError 崩溃。这是阻塞性问题，不改会崩。

### D8: 并发刷新防护（Oracle 必须建议 #3）

**选择**: per-server 刷新锁，防止手动 `/mcp refresh` 与后台 `_refreshTask` 双重 connect：
- `refreshServer(name)` 开头检查 `connections[i].status`：
  - `connecting`（已有进行中 connectionPromise）→ `await conn.connectionPromise` 后返回（不重新 connect，避免双重连接）
  - `connected` → 手动 refresh 场景强制重连（置回 `connecting` 再 connect）
  - `cached`/`failed` → 执行 connect
- `refreshTools()`（公开 API）全量刷新时：若 `_refreshTask` 存在且未完成，先 `await this._refreshTask` 再重新刷新

**理由**: 并发刷新会导致同一 server 双重 connect、connectionPromise 被覆盖、缓存写入冲突。

**替代方案**:
- 全局互斥锁：粒度太粗，一个 server 刷新时阻塞所有。
- AbortController 取消旧任务：复杂度高，MVP 不需要。

### D9: 热替换语义（Oracle 建议）

**选择**: 后台刷新每完成一个 server 调用 `rebuildToolDefinition()` 更新 `_toolDefinition` 引用，但**已注册到 Pi SDK 的 schema 快照不会被热替换**。语义明确：
- 后台刷新发现的 tool 变更**不立即影响当前运行中的 agent session**
- 只有下次 `setActiveToolsByName`（如 `handleSetAgentMode`）或新 session 创建时才用新 schema
- 这是正确行为：避免 agent 中途 schema 突变导致已发出的调用参数不一致

**理由**: Pi SDK 注册工具定义后取快照。`_toolDefinition` 引用热替换只影响下次注册。execute 路径（executeTool）每次调用都重新查 `connections` 数组拿连接态，所以 tool 执行总能拿到最新连接，只是 schema（参数定义）在当前 session 内稳定。

## Risks / Trade-offs

- **[null client/transport 崩溃]**（Oracle #1，已由 D7 缓解）占位 connection 的 client/transport 为 null → executeTool/dispose/getAuthorizedToolDefinition 加 status 检查与 null guard，D4 await 路径前置保证 execute 时 client 就绪。
- **[execute 永久阻塞]**（Oracle #2，已由 D4 缓解）server hang 时 connectionPromise 不 resolve → `Promise.race([promise, timeout(10s)])` 兜底，超时返回清晰错误。
- **[并发刷新冲突]**（Oracle #3，已由 D8 缓解）手动 refresh 与后台 _refreshTask 双重 connect → per-server status 锁，connecting 状态 await 已有 promise。
- **[缓存与实际不一致]** agent 可能在后台刷新完成前基于陈旧 schema 调用已不存在的 tool → execute await 连接成功后用实时 tools 校验 tool_name 存在，不存在返回清晰错误；连接失败/超时则提示手动 refresh。
- **[缓存文件损坏]** 用户手动编辑或磁盘故障导致 JSON 损坏 → `readCache()` try/catch，损坏时删除文件 + 降级同步连接 + 警告日志，不中断启动。
- **[后台刷新异常未捕获]** 后台 promise 抛错无人处理 → 每个 server 独立 try/catch，失败置 `status:"failed"`，不影响其他 server；整体 `.catch(console.error)` 兜底。
- **[进程退出时后台任务未完成]** 刷新中用户退出 → `dispose()` 置 `_disposed:true`，后台任务检查后跳过热替换；进程退出连接自然清理。
- **[首次启动无加速]** 首次运行无缓存，体验同现状 → 可接受，缓存写入后后续启动即加速。
- **[热替换不影响当前 session]**（Oracle 建议，已由 D9 明确）后台刷新更新 `_toolDefinition` 引用，但 Pi SDK 已注册的 schema 是快照，当前 agent session 不受影响 → 正确行为，避免中途 schema 突变。
- **[stale 状态语义]** agent 看到 cached/connecting 状态的 tool 可能困惑 → description 标记 `(cached, 刷新中)`，`/mcp status` 提供查询入口；显式 `ConnectionStatus` 枚举降低维护者认知负担。
- **[configHash 碰撞]** 极低概率 → SHA-256 碰撞可忽略，且碰撞只会用旧缓存（走 cached→connecting 路径仍会刷新），不会数据错误。
