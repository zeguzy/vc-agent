## ADDED Requirements

### Requirement: team 工具暴露 spawn / poll / cancel 三个动作

系统 SHALL 在 `src/tools/team.ts` 定义单一 ToolDefinition 暴露给主 agent，参数 schema 中 `action` 字段决定执行分支：`"spawn"`（启动后台 worker，非阻塞立即返回 workerId）、`"poll"`（拉取 worker 状态与 summary，可选 `wait: true` 阻塞到所有 polled worker 结束）、`"cancel"`（取消指定或全部 worker）。V1 不定义 `"broadcast"` action；V2 mailbox 提案中再独立设计。`team` 工具与现有同步 `subagent` 工具并存，互不影响。

#### Scenario: spawn 动作启动后台 worker
- **WHEN** 主 agent 调用 `team` 工具，参数 `{action: "spawn", agent: "lysosome", task: "review src/auth"}`
- **THEN** SHALL 调用 `WorkerSessionPool.spawnWorker`
- **AND** SHALL 立即（不 await prompt）返回工具结果 `{content:[{type:"text", text:`spawned worker wkr_a1 (agent=lysosome, status=running)`}]}`，主 agent 上下文只看到一行 spawn 回执，**不**看到 worker 的中间过程

#### Scenario: poll 动作非阻塞拉快照
- **WHEN** 主 agent 调用 `team` 工具，参数 `{action: "poll", workerIds: ["wkr_a1","wkr_b2"], wait: false}`
- **THEN** SHALL 立即返回每个 polled worker 的 `{id, agent, status, turnCount, tokenUsage, cost, lastSummary?}`
- **AND** 未传入 `workerIds` 时 SHALL 返回**全部** worker 快照
- **AND** `lastSummary` 超过 1KB 时 SHALL 截断并追加 `"[full output truncated, N tokens, use poll full=true to expand]"`

#### Scenario: poll 动作阻塞等待
- **WHEN** 主 agent 调用 `team` 工具，参数 `{action: "poll", workerIds: ["wkr_a1","wkr_b2"], wait: true}`
- **THEN** SHALL await 直到所有 polled worker 进入终态（`done` / `error` / `cancelled`）
- **AND** SHALL 有 60 秒默认 timeout，超时返回当前进度 + `"[poll timeout, N workers still running]"`
- **AND** 接收到的 `lastSummary` 默认 truncated；`full: true` 参数 SHALL 返回完整文本（受 maxTokens 限制）

#### Scenario: cancel 动作取消 worker
- **WHEN** 主 agent 调用 `team` 工具，参数 `{action: "cancel", workerId: "wkr_a1"}`
- **THEN** SHALL 调用 `WorkerSessionPool.cancel(workerId)`
- **AND** SHALL 返回工具结果 `{content:[{type:"text", text:`cancelled worker wkr_a1`}]}`

#### Scenario: cancel 不传 workerId 取消全部
- **WHEN** 主 agent 调用 `team` 工具，参数 `{action: "cancel"}`（无 `workerId` 字段）
- **THEN** SHALL 调用 `WorkerSessionPool.cancelAll()`
- **AND** SHALL 返回取消的 workerId 列表

#### Scenario: spawn 失败返回 isError
- **WHEN** `team.spawn` 因 worker pool 满 / agent 定义不存在 / frontmatter `background: false` 而失败
- **THEN** SHALL 返回 `{isError: true, content: [{type: "text", text: "<具体错误>"}]}`
- **AND** 错误信息 SHALL 包含可操作建议（如 `"pool exhausted, wait for some worker to finish"`）

### Requirement: Team orchestrator system prompt 注入

系统 SHALL 在 `src/context-files.ts` 加载链中条件性追加 team orchestrator system prompt 段落，指导主 agent 在收到适合 spawn 的需求时使用 `team` 工具而非同步 `subagent` 工具。该段落 SHALL 仅在 `Config.teams.enabled !== false` 且主 agent 处于 `"standard"` 模式（非 `"planner"`）时启用。

#### Scenario: 加载 team orchestrator prompt
- **WHEN** 系统启动且 `Config.teams.enabled !== false` 且主 agent 当前模式为 `"standard"`
- **THEN** systemPrompt SHALL 在 base prompt 之后追加 team orchestrator 段，至少包含：
  - 异步委派对范式说明：当任务包含**多个独立的、并行可推进的**子工作时使用 `team.spawn`
  - spawn 后**继续推进**主路线工作，不要立刻 poll；当所有 worker 都到关键节点或最后聚合时再 `team.poll wait=true`
  - `subagent` 工具适用场景（**同步**要求立即拿到结果）与 `team` 工具适用场景（**异步**可继续推进）的区分准则
  - 失败处置：`team.poll` 看到 `error` 时由主 agent 决定 retry / 换 model 重 spawn

#### Scenario: planner 模式不启用 team prompt
- **WHEN** 主 agent 当前模式为 `"planner"`
- **THEN** SHALL NOT 加载 team orchestrator prompt（planner 只读模式，不应 spawn 后台 worker 改代码）

#### Scenario: 配置禁用 teams
- **WHEN** `Config.teams.enabled === false`
- **THEN** SHALL NOT 加载 team orchestrator prompt
- **AND** `team` 工具 SHALL 从 active tools 列表中移除，主 agent 看不到该工具

### Requirement: /team 与 /workers slash 命令

系统 SHALL 在 `src/tui/commands.ts` 注册以下命令，对接 `AgentClient` 的 team 接口：

- `/team spawn <agent> "<task>"`：等价于在主输入框发送自然语言触发 `team.spawn` 工具，但直接调用 `client.spawnWorker()` 不经过主 agent LLM
- `/team poll [workerId...]`：拉取 worker 状态摘要
- `/team cancel [workerId]`：取消单个或全部 worker
- `/workers`：进入 worker 选择器视图，方向键导航 + Enter 聚焦 + ESC 退出

#### Scenario: /team spawn 用户直接派活
- **WHEN** 用户在主输入框输入 `/team spawn lysosome "review src/auth for SQL injection"`
- **THEN** SHALL 直接调用 `client.spawnWorker({agent: "lysosome", task: "..."})`，不经过主 agent LLM
- **AND** SHALL 在 TUI 中立即显示 worker 创建消息
- **AND** 主 agent SHALL 保持 idle 状态（用户不再发消息则不会触发新 prompt）

#### Scenario: /workers 进入选择器
- **WHEN** 用户输入 `/workers` 且存在至少一个 worker
- **THEN** TUI SHALL 切到 `WorkersView` 视图，渲染 worker 列表，每行显示 `wkr_xxx · agent · status · lastSummary(truncated)`
- **AND** `j/k` 上下导航、`Enter` 聚焦查看某个 worker 的完整输出历史、`ESC` 退出回主消息流
- **AND** V1 不实现 `/workers` 内的 `send-to-worker`/`toss message` 能力——send-to-worker 留待 V2 mailbox 提案中同期落

#### Scenario: /workers 无 worker 时提示
- **WHEN** 用户输入 `/workers` 且无任何 worker 存在
- **THEN** TUI SHALL 显示提示 `No active workers. Spawn one with /team spawn <agent> "<task>"`
- **AND** SHALL 不切换视图，保持主消息流

### Requirement: AgentClient 接口扩展

系统 SHALL 在 `src/client/types.ts:AgentClient` 接口新增以下方法，并由 `src/client/in-process.ts` 与 `src/client/http.ts` 实现：

- `listWorkers(): WorkerSnapshot[]`
- `getWorker(id): WorkerSnapshot | undefined`
- `spawnWorker(opts: {agent, task, cwd?}): Promise<{workerId, status}>`
- `cancelWorker(id): Promise<void>`
- `cancelAllWorkers(): Promise<void>`
- `onWorkerEvent(listener): Unsubscribe`

#### Scenario: in-process 实现直连 WorkerSessionPool
- **WHEN** TUI 通过 `InProcessClient` 调用 `spawnWorker`
- **THEN** SHALL 直接调用 `agentServer.workerPool.spawnWorker(opts)`
- **AND** `onWorkerEvent(listener)` SHALL 通过 `agentServer.eventHandlers` 订阅 `team_worker_event` 事件

#### Scenario: HTTP 客户端实现限流订阅
- **WHEN** `HttpClient` 调用 `onWorkerEvent`
- **THEN** 接收 SSE `team_worker_event` 帧
- **AND** 默认 SHALL 仅订阅 `kind === "message_end" || kind === "agent_end" || kind === "error"` 的 worker 事件，不接收 `message_delta` 流式 token（避免远程流量爆炸）
- **AND** 客户端可选传 `subscribeWorkers({streaming: true})` 开启流式 token 接收