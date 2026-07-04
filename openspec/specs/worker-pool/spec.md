# worker-pool Specification

## Purpose
TBD - created by archiving change add-teams-mode. Update Purpose after archive.
## Requirements
### Requirement: Worker session pool 生命周期管理

系统 SHALL 通过 `src/teams/manager.ts:WorkerSessionPool` 维护一组后台异步 worker session，提供 `spawnWorker` / `get` / `list` / `cancel` / `cancelAll` / `dispose` 接口。每个 worker 持有一个独立 Pi SDK `AgentSession`（由 `createAgentSession` 创建、配置 `noSkills: true`、`noContextFiles: true`，注入 worker 专属 agent 定义的 `appendSystemPrompt`），worker 不进 `SessionManager` 持久化列表，dispose 即清。

#### Scenario: spawn 后台 worker
- **WHEN** 主 agent 调用 `team.spawn` 工具传入 `{agent: "lysosome", task: "review src/auth"}`
- **THEN** `WorkerSessionPool.spawnWorker` SHALL 通过 `createAgentSession()` 创建独立会话，配置 `appendSystemPrompt: [agent.systemPrompt]`、`tools: agent.tools`、`disallowedTools: agent.disallowedTools`（含默认 `["write", "edit"]`）、`model: resolveModel(...)` 或父 model
- **AND** SHALL 生成形如 `wkr_<8 字符 base32>` 的 workerId 并存入 `workers: Map<workerId, Worker>`
- **AND** SHALL 注册 `session.subscribe()` 转发为 `WorkerEventEnvelope`
- **AND** SHALL 调用 `session.prompt(task)` **不 await**，立即返回 `{workerId, status: "running"}` 给主 agent

#### Scenario: 同一时刻并发上限
- **WHEN** `WorkerSessionPool.list().filter(running).length >= Config.teams.maxWorkers`（默认 4）
- **AND** 主 agent 再次 `team.spawn`
- **THEN** SHALL **不排队等待**，立即抛错 `Error("worker pool exhausted: maxWorkers=N reached")`
- **AND** 该错误 SHALL 作为 `team.spawn` 工具的 `isError: true` 结果回喂主 agent，由主 agent 自行决定 retry 时机

#### Scenario: 列举所有 worker 状态
- **WHEN** 主 agent 或用户调用 `listWorkers()`
- **THEN** SHALL 返回 `WorkerSnapshot[]`，每条包含 `{id, agent, status, turnCount, tokenUsage, cost, lastSummary?}`
- **AND** `status` 取值为 `"running" | "idle" | "done" | "error" | "cancelled"`

#### Scenario: 取消单个 worker
- **WHEN** 调用 `cancel(workerId)` 且对应 worker 处于 `running`
- **THEN** SHALL 调用 `worker.session.abort()` 中止 LLM 请求
- **AND** SHALL 置 worker 状态为 `cancelled`
- **AND** SHALL emit `kind: "error"` 的事件给订阅者，payload 含 `{reason: "cancelled"}`

#### Scenario: 进程退出 disposeAll
- **WHEN** Bun 进程收到 `SIGINT` / `SIGTERM` 或 `process.on("exit")`
- **THEN** `WorkerSessionPool` SHALL 同步遍历所有 worker，**忽略未完成**的 prompt promise，直接 `session.dispose()`
- **AND** dispose 失败的 worker SHALL 不阻塞其他 worker dispose

#### Scenario: worker 不写入会话持久化目录
- **WHEN** `WorkerSessionPool.spawnWorker` 创建 `createAgentSession`
- **THEN** SHALL NOT 调用 `SessionManager.create` / `SessionManager.continueRecent` / `SessionManager.open`
- **AND** Worker session SHALL 不写入 `~/.config/openagent/sessions/` 目录
- **AND** worker `dispose()` 后无任何会话 JSONL 文件残留

### Requirement: Worker maxTurns 硬上限

系统 SHALL 为每个 worker 实例化时设置 `maxTurns`（取 agent frontmatter `maxTurns` 字段，否则 `Config.teams.defaultMaxTurns`，默认 8）。worker turn 计数达到上限时 SHALL 强制中止并标记为 error。

#### Scenario: 命中 maxTurns 自动中止
- **WHEN** Worker 收到 `message_end` 事件累计的 turn 计数 ≥ worker.maxTurns
- **THEN** SHALL 调用 `session.abort()` 中止下一轮
- **AND** SHALL 置状态为 `error`，lastSummary 标注 `"hit_maxTurns (N)"`
- **AND** SHALL emit `kind: "error"` 事件，payload `{reason: "hit_maxTurns", turns: N}`

#### Scenario: frontmatter 覆盖默认 maxTurns
- **WHEN** agent 定义文件的 frontmatter 声明了 `maxTurns: 20`
- **THEN** 该 worker SHALL 使用 `20` 而非 `Config.teams.defaultMaxTurns`

### Requirement: Worker 事件聚合与路由

系统 SHALL 通过 `WorkerSessionPool.subscribe(listener)` 暴露事件聚合接口，worker 的 Pi SDK 事件经包装为 `WorkerEventEnvelope` 后转发给所有订阅者。`AgentServer` 在其现有 `eventHandlers` 路径中**追加**一个新事件类型 `team_worker_event`，不污染现有事件 schema。

#### Scenario: worker message_delta 转发
- **WHEN** 某 worker 的 `session.subscribe` 收到 `message_update` 事件含 `text_delta`
- **THEN** `WorkerSessionPool` SHALL 转发 `WorkerEventEnvelope { type: "team_worker_event", workerId, workerAgent, kind: "message_delta", payload: <原始 SDK event> }` 给所有订阅者

#### Scenario: worker agent_end 转发
- **WHEN** worker 收到 `agent_end` 事件
- **THEN** SHALL 转发 `kind: "agent_end"`，并置 worker 状态为 `done`
- **AND** SHALL 提取 assistant 最终文本作为 `lastSummary` 写入 WorkerSnapshot

#### Scenario: 现有事件 schema 隔离
- **WHEN** `AgentServer.eventHandlers` 收到 `team_worker_event` 类型事件
- **THEN** 订阅者 SHALL 通过 `event.type === "team_worker_event"` 路由判断，**不**触发现有 `agent_start` / `message_update` / `tool_execution_*` 处理路径
- **AND** 现有事件类型 schema SHALL 保持不变

### Requirement: 主 agent 结束时孤儿 worker 处理

系统 SHALL 在 `AgentServer.handleAgentEnd` 收到主 agent 的 `agent_end` 事件时检查 `WorkerSessionPool.runningCount`，依据 `Config.teams.cancelOrphansOnAgentEnd`（默认 `true`）决定是否自动取消孤儿 worker。

#### Scenario: 孤儿 worker 自动取消（默认）
- **WHEN** 主 agent `agent_end` 触发，`WorkerSessionPool.runningCount > 0` 且 `Config.teams.cancelOrphansOnAgentEnd !== false`
- **THEN** SHALL 调用 `workerPool.cancelAll()` 中止所有 running worker
- **AND** SHALL emit 事件 `team_orphans_cancelled`，payload 含被取消 workerId 列表
- **AND** TUI SHALL 在主消息流末尾显示提示行 `[N orphan workers cancelled]`

#### Scenario: 关闭自动取消保留后台 worker
- **WHEN** `Config.teams.cancelOrphansOnAgentEnd === false`
- **THEN** SHALL 不自动 cancelAll，worker 继续后台跑
- **AND** 进程退出钩子 SHALL 仍保证 `workerPool.disposeAll()` 被调用

### Requirement: 主 session 切换时孤儿 worker 处理

系统 SHALL 在 `AgentServer` 注册 `runtime.setRebindSession` 钩子时（与现有 `clearEditConfirmBridge` 钩子同位置）调用 `WorkerSessionPool` 孤儿检查。`Config.teams.cancelOrphansOnSessionChange` 默认 `true`：自动 `cancelAll()` 并 emit `team_orphans_cancelled`；显式设 `false` 时保留 worker 后台运行（不受新主 session 影响）。

#### Scenario: 主 session 切换默认自动取消 worker（防 context 失配）
- **WHEN** 主 agent 触发 `runtime.switchSession(path)` 或 `runtime.newSession()` 完成 rebind
- **AND** `Config.teams.cancelOrphansOnSessionChange !== false`（默认 true）
- **THEN** `AgentServer` SHALL 在 rebind 钩子内同步调用 `workerPool.cancelAll()`
- **AND** SHALL emit 事件 `{type: "team_orphans_cancelled", workerIds: [...]}` 给所有 `eventHandlers`
- **AND** TUI SHALL 在新 session 主消息流末尾显示提示行 `[N orphan workers cancelled due to session change]`

#### Scenario: 关闭自动取消保留跨 session worker
- **WHEN** `Config.teams.cancelOrphansOnSessionChange === false`
- **THEN** SHALL 不自动 cancelAll，worker 在新主 session 上下文中继续后台执行
- **AND** 进程退出钩子 SHALL 仍保证 `workerPool.disposeAll()` 调用
- **AND** TUI SHALL 在 StatusBar 显示提示 `teams: N orphan worker(s) still running in old session context`

