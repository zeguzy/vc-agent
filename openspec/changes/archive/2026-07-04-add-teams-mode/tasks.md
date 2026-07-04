## 1. 类型与配置基础

- [x] 1.1 在 `src/teams/types.ts` 定义 `WorkerId`、`WorkerStatus`、`WorkerSnapshot`、`WorkerEventEnvelope`（含 `team_worker_event` type 字段）、`TeamOrphansCancelledEvent`、`AgentClientEvent` union、`WorkerEventKind`、`TeamConfig`、`DEFAULT_TEAM_CONFIG`、`WorkerPoolRef = { current: WorkerSessionPool | null }`；集中默认值（maxWorkers=4 / defaultMaxTurns=8 / isolation="none" / cancelOrphansOnAgentEnd=true / cancelOrphansOnSessionChange=true）
- [x] 1.2 在 `src/config.ts:Config` 接口新增可选字段 `teams?: TeamConfig`，确保 deepMerge 行为正确；为 `isolation="worktree"` 配置写一次性 stderr `teams.isolation="worktree" not yet implemented, falling back to "none"` warning（保留 reserved 字段位，V1 视 `"worktree"` 等同 `"none"`）；同理新增 `cancelOrphansOnSessionChange` 字段
- [x] 1.3 在 `src/agents/types.ts:AgentDefinition` 接口新增可选字段 `disallowedTools?: string[]` / `maxTurns?: number` / `background?: boolean` / `permissionMode?: "default"|"plan"|"acceptEdits"`（V1 不包含 `"bypass"`，避免破坏安全基线）；更新 YAML frontmatter 解析的 typings

## 任务依赖关系（参考，非线状）

```
1 ─┐
   ├─► 2 ─┐
   │      └─► 3 ─┐
   │            └─► 4 ─┐
   │                  ├─► 5 ─► 6 / 7 / 8 / 9 / 10 / 10b（并行）
   │                  ├─► 11（并行，依赖 1 与 4 不强耦合）
   │                  ├─► 12（依赖 4 与 7）
   │                  └─► 13（依赖 4 与 11）
14 ───── 等前面所有完成 ─────► 14.6（最终 check）
```

依赖要点：5 依赖 4.1、8 依赖 4.3、9 依赖 7 与 8、10b 依赖 5、12 依赖 4 与 7、13 依赖 4 与 11。

## 2. Agent 定义解析与扩展字段

- [x] 2.1 在 `src/agents/discover.ts:loadAgentsFromDir` 的 frontmatter parser 增加解析上述四个新字段；解析失败 / 类型不符 SHALL 沿用现有"跳过该 agent 并 warn"行为
- [x] 2.2 为 frontmatter 解析新增单元测试 `tests/agents-discover.test.ts`：覆盖 disallowedTools 数组、maxTurns 数字越界、background 布尔、permissionMode 枚举，以及未声明字段回退默认

## 3. Worker session 单元

- [x] 3.1 在 `src/teams/worker.ts` 实现 `Worker.spawn` 工厂函数：**直接**在 worker.ts 内创建独立 `createAgentSession`（不复用、不抽出 `runSubagent` 代码）；持有 `WorkerEventEmitter` / status / turnCount / lastSummary / lastError 字段；与同步 `runSubagent` 现有路径并行存在，不立刻重构共享代码
- [x] 3.2 实现 `Worker.spawn` 内部 `session.subscribe()` 转发事件到实例 `eventBus`，订阅 `message_end` 累计 turnCount / extractAssistantText 写入 lastSummary；命中 maxTurns（取 agent.maxTurns ?? Config.teams.defaultMaxTurns）时 `session.abort()` 并置 status=error，emit error 事件
- [x] 3.3 实现 worker active tools 构造：从 `agent.tools ?? BUILTIN_TOOLS` 出发，应用 `disallowedTools` deny → `tools` allow → 强制移除 `question` / `lsp_diagnostics` / `lsp_goto_definition` / `lsp_find_references`（worker 不注入 LSP 与 question）；默认再移除 `write` / `edit`（与 D5 一致）。frontmatter `tools` 含 LSP 工具名时 stderr warn
- [x] 3.4 实现 worker `try { await session.prompt(task) } catch (e) { status=error, lastError=e.message, emit kind=error }` 唯一 error 转换路径（覆盖 LLM 限流 / 网络 drop / API timeout）
- [x] 3.5 实现 `Worker.cancel()` / `Worker.dispose()`：cancel 调 `session.abort()` + 置 cancelled；dispose 解除订阅 + `session.dispose()`；用 try/catch 包裹确保单 worker 失败不传染
- [x] 3.6 单测 `tests/teams-worker.test.ts`：mock `createAgentSession`，验证 spawn 不阻塞 / maxTurns 命中 / 工具集 LSP+question 被过滤 / error 转换路径 / cancel / dispose 行为（不实际打 LLM）

## 4. WorkerSessionPool 与 AgentServer 集成

- [x] 4.1 在 `src/teams/manager.ts` 实现 `WorkerSessionPool`：内部 `Map<WorkerId, Worker>`，对外 `spawnWorker` / `get` / `list` / `cancel` / `cancelAll` / `dispose` / `subscribe(listener)`；spawn 时尊重 `Config.teams.maxWorkers` 硬上限，超限抛 `Error("worker pool exhausted")`
- [x] 4.2 `WorkerSessionPool.subscribe` 转发所有 WorkerEvent 给 listeners；订阅者收到 `kind: "agent_end"` 时 SHALL 把对应 worker 状态置 done + 写 lastSummary
- [x] 4.3 改造 `src/server/index.ts:AgentServer`：新增 `workerPool: WorkerSessionPool` 字段，在 `ensureSubscribed` 路径中挂 `workerPool.subscribe` → 把 `WorkerEventEnvelope` 包成 `team_worker_event` 一同分发给已有 `eventHandlers`，不修改现有 event schema
- [x] 4.4 实现 `AgentServer.handleAgentEnd` 钩子查 `workerPool.runningCount`，按 `Config.teams.cancelOrphansOnAgentEnd` 默认自动 `cancelAll()` 并 emit `team_orphans_cancelled` 事件
- [x] 4.5 在 `AgentServer` 注册 `runtime.setRebindSession` 钩子时（与现有 `clearEditConfirmBridge` 钩子同位置）调 `workerPool.cancelAll()` 受 `Config.teams.cancelOrphansOnSessionChange` 控制；emit `team_orphans_cancelled` 与 4.4 复用同一 emit helper
- [x] 4.6 在进程退出钩子上挂 `process.on("exit")` / `SIGINT` / `SIGTERM`：调 `agentServer.workerPool.dispose()`，失败 worker 不阻塞其他 worker dispose
- [x] 4.7 单测 `tests/teams-pool.test.ts`：mock worker 层，验证 maxWorkers 硬拒绝 / cancelAll / disposed 后 workers map 清空 / event handlers 收到 team_worker_event 与 team_orphans_cancelled 标签

## 5. team 工具

- [x] 5.1 在 `src/tools/team.ts` 实现 ToolDefinition，参数 schema 含 `action: "spawn"|"poll"|"cancel"` + 各 action 对应字段（agent/task/workerIds/wait/full/workerId）；构造参数含 `WorkerPoolRef`（D2 注入路径）
- [x] 5.2 实现 spawn 分支：每次 execute 时读 `poolRef.current`；若为 null 返回 isError `teams not initialized yet`；非 null 则调 `workerPool.spawnWorker`，立即返回工具结果 `{workerId, status}`，失败（pool 满 / agent 不存在 / `background=false` 工具被无效 agent 调用）返回 isError 含可操作建议
- [x] 5.3 实现 poll 分支：默认 `wait=false` 立即返回所有 worker 快照；`wait=true` 阻塞 await 到所有 polled worker 进入终态，含 60s 默认 timeout（超时返回当前进度 + `[poll timeout, N workers still running]`）；默认 truncated summary ≤ 1KB，`full=true` 返回完整 lastSummary
- [x] 5.4 实现 cancel 分支：传 `workerId` 取消单个，未传则全 cancelAll
- [x] 5.5 在 `src/agent/session.ts:initServices` 把 `team` 工具加入 `customTools` 数组；当 `Config.teams.enabled === false` 时 SHALL 不注册（从 active tools 列表移除）；在 `AgentServer` 构造完成后立即 `poolRef.current = agentServer.workerPool` 完成延迟注入
- [x] 5.6 单测 `tests/tools-team.test.ts`：mock workerPool，覆盖三个 action 的 happy / error 路径 + `poolRef.current === null` 时的 `teams not initialized yet` 行为

## 6. Team orchestrator system prompt

- [x] 6.1 在 `src/context-files.ts` 新增 `TEAM_ORCHESTRATOR_PROMPT` 常量段：说明 spawn 后继续推进 / 异步 vs 同步 subagent 选择准则 / poll error 处置策略
- [x] 6.2 修改 `loadSystemContext` 在 `Config.teams.enabled !== false && agentMode === "standard"` 时追加该段；planner 模式与 disabled 时 SHALL NOT 追加

## 7. AgentClient 接口扩展

- [x] 7.1 在 `src/client/types.ts:AgentClient` 新增六方法：`listWorkers` / `getWorker` / `spawnWorker` / `cancelWorker` / `cancelAllWorkers` / `subscribeTeam`
- [x] 7.2 在 `src/client/in-process.ts:InProcessClient` 实现上述方法：直连 `agentServer.workerPool`；`onWorkerEvent` 通过 `agentServer.handleSubscribeTeam` 订阅 `team_worker_event`
- [x] 7.3 在 `src/client/http.ts:HttpClient` 实现上述方法：spawnWorker/cancel/worker 状态走新 REST endpoint（如 `/team/spawn` `/team/cancel/:id` `/team/workers`），`onWorkerEvent` 通过 SSE 订阅默认仅 `kind ∈ {message_end, agent_end, error}`，`subscribeWorkers({streaming:true})` 开启流式 token

## 8. TUI 消息模型与流式渲染

- [x] 8.1 在 `src/message.ts:MessageRole` 新增 `"worker"` / `"worker-summary"`；扩展 `Message` 接口字段 `workerId?` / `workerAgent?` / `workerStatus?`；新增 helper `createWorkerMessage(workerId, agent, delta)` / `createWorkerSummaryMessage(workerId, agent, status, summary)`
- [x] 8.2 在 `src/tui/hooks/useSessionEvents.ts` 处理 `team_worker_event`：`message_delta` → 插入或追加对应 worker 消息（80ms 节流，复用 useStreamingBuffer 机制）；`agent_end` / `error` → 把 worker 消息升格为 `worker-summary`，置 workerStatus
- [x] 8.3 在 `src/tui/components/MessageList.tsx` 新增 `WorkerMessageView` 圆角框组件：顶部行状态图标 + `wkr_xxx/agent`，内容区渲染流式 token via markdown 组件；done 折叠为 content 空状态
- [x] 8.4 新增 `WorkerSummaryView`：单行 `<状态图标> <id>/<agent> summary: <truncated>`，无边框，`textSubtle` 色；> 100 字符截断追加 "…"
- [x] 8.5 验证并行 worker 渲染互不污染：mock 两个 worker 同时 delta 流，断言仅对应 worker 消息块重渲染（`React.memo` 包装默认值保持不变）

## 9. /workers 选择器视图

- [x] 9.1 在 `src/tui/components/WorkersView.tsx` 实现列表视图：调用 `client.listWorkers()` 渲染 `<scrollbox>` 列表，每行 `<状态图标> wkr_xxx · agent · status · lastSummary(60 字符)`；当前选中行反色高亮
- [x] 9.2 在 `src/tui/App.tsx` 新增 view 状态 `"workers"`，渲染 `<WorkersView>`；j/k/g/G 导航 + Enter 聚焦 + ESC 退出回主消息流
- [x] 9.3 实现聚焦单个 worker：渲染该 worker 完整流式历史 in 独立 `<scrollbox>`，顶部显示 `<- ESC back`；聚焦中 worker 终结时刷新状态但不退出;空列表时不切 view，仅显示提示行

## 10. Slash 命令

- [x] 10.1 在 `src/tui/commands.ts:registerBuiltinCommands` 注册 `/team spawn <agent> "<task>"`：解析参数 → 直调 `client.spawnWorker()`，不经主 agent LLM；spawn 后立即在主消息流插 worker 创建提示
- [x] 10.2 注册 `/team poll [workerId...]`：调 `client.listWorkers` / `cancelAllWorkers`-style 接口。`/team cancel [workerId]`：参数缺失则全 cancel；`/team poll` 不带参数返回所有 worker 快照
- [x] 10.3 注册 `/workers` 命令切换 view 状态为 `"workers"`；无 worker 时显示提示而非切 view
- [x] 10.4 命令在 `Config.teams.enabled === false` 时统一显示 `teams disabled in config`

## 10b. 嵌套 team 与权限收敛

- [x] 10b.1 在 `src/tools/team.ts:execute` 检测调用栈 worker 标识（比对 `WorkerPoolRef.current` 中 worker id $\cap$ 当前 session id），worker 上下文中调用 `team` 任一 action SHALL 立即返回 isError `nested team calls are forbidden`
- [x] 10b.2 在 `src/agents/discover.ts` YAML 解析处增加 `permissionMode` 取值校验：仅 `"default"|"plan"|"acceptEdits"` 三值合法，`"bypass"` 或其他值 SHALL 跳过该 agent 并 stderr warn（参见 agent-session spec Scenario `permissionMode 枚举拒收 bypass`）

## 11. Setting 注册表

- [x] 11.0 在 `src/settings/types.ts:SettingCategory` 扩展联合类型，新增 `"teams"` 取值（现有 closed union `"ui"|"session"|"notifications"`）；同步更新 `registry.ts` 按 category 分组渲染逻辑使新分组自动可见
- [x] 11.1 新增 `src/settings/teams-enabled.ts` 实现 `Setting<boolean>`：`key:"teams.enabled"` / `label:"Teams 模式"` / `category:"teams"` / `defaultValue:true`；apply 通过 `ctx.setConfig` 写入运行时 Config（不影响运行中 worker）；persist 走 deepMerge
- [x] 11.2 新增 `src/settings/teams-max-workers.ts` 实现 `Setting<string>`：默认 `"4"`，`edit` 校验 1-16 范围
- [x] 11.3 新增 `src/settings/teams-default-max-turns.ts` 实现 `Setting<string>`：默认 `"8"`，`edit` 校验 1-50 范围
- [x] 11.4 三个新 Setting 注册到 `src/settings/registry.ts:settings` 数组，纳入 `category:"teams"` 分组；`/setting` 页面按 `category` 渲染时 SHALL 自动显示新分组

## 12. HTTP serve+attach 端点

- [x] 12.1 在 `src/server/http.ts`（或现有 HTTP server 路由文件）新增端点 `POST /team/spawn` / `POST /team/cancel/:id` / `POST /team/cancel` / `GET /team/workers`，调 appropriate `workerPool` 方法
- [x] 12.2 扩展 SSE endpoint 增加 `team_worker_event` 帧推送，默认仅 `kind ∈ {message_end, agent_end, error}`；客户端 `?streaming=true` 参数开启流式 token

## 13. headless runner 适配

- [x] 13.1 在 `src/headless/runner.ts` 订阅 `team_worker_event`，打 worker 事件日志：`[worker wkr_xxx] <kind> <summary truncated>`，不阻塞主输出
- [x] 13.2 headless 模式下 `Config.teams.enabled === false` 时主 agent 不在 active tools 看到 `team` 工具，验证 headless 跑无意外报错

## 14. 集成与质量门禁

- [x] 14.1 在 `tests/teams-integration.test.ts` 写端到端集成测试：mock 主 agent prompt 触发 `team.spawn` → 验证 workerPool 创建 worker、事件流经 AgentServer、handler 收到 team_worker_event 标签；spawn 后主 agent 调 `team.poll wait=true` 时 await 正确
- [x] 14.2 事后重构 `src/agents/runner.ts:runSubagent` 与 `src/teams/worker.ts` 共享 session 工厂代码：抽出工厂函数，通过参数区分 `await prompt`（同步 subagent）vs fire-and-track（异步 worker）；保持同步 subagent 调用路径行为完全不变；补测 `tests/subagent-backwardcompat.test.ts` 覆盖 single / parallel / chain 三模式行为不变
- [x] 14.3 运行 `bun run typecheck`，修复所有 type 错误
- [x] 14.4 运行 `bun run lint`，修复所有 lint 错误
- [x] 14.5 运行 `bun test`，确保新测试通过且旧测试无回归
- [x] 14.6 运行 `bun run check`（typecheck + lint + test 全套）确认全绿