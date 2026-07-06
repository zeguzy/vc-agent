# team-orchestration Specification

## Purpose
TBD - created by archiving change add-teams-mode. Update Purpose after archive.
## Requirements
### Requirement: team 工具暴露 spawn / poll / cancel 三个动作

系统 SHALL 在 `src/tools/team.ts` 定义单一 ToolDefinition 暴露给 leader agent，参数 schema 中 `action` 字段决定执行分支：`"read"`（读取 TEAM.md 状态）、`"create"`（创建成员）、`"assign"`（分配任务）、`"direct"`（向活跃成员发送指令）、`"edit-member"`（编辑成员属性）、`"complete"`（完成任务）、`"remove"`（移除成员）。成员与 leader 同构——使用相同的持久化 `SessionManager` API，成员 session 文件存放在标准 sessions 目录（`~/.config/openagent/sessions/`）下。TEAM.md members 表 SHALL 通过 `Session` 列持有成员的 sessionFile 引用。`team` 工具与现有同步 `subagent` 工具并存，互不影响。

#### Scenario: create 动作创建持久化成员（与 leader 同构）
- **WHEN** leader agent 调用 `team` 工具，参数 `{action: "create", name: "alice", role: "实现者", goal: "..."}`
- **THEN** SHALL 调用 `TeamManager.createMember`
- **AND** `createMember` SHALL 使用 `SessionManager.create(cwd, sessionDir)` 创建持久化 session（与 leader 相同的 API）
- **AND** sessionDir SHALL 为标准 `resolveSessionDir()`（与 leader 相同）
- **AND** 成员 session 文件 SHALL 位于标准 sessions 目录
- **AND** TEAM.md members 表 SHALL 在 Session 列记录成员的 sessionFile 路径

#### Scenario: read 动作返回当前团队状态
- **WHEN** leader agent 调用 `team` 工具，参数 `{action: "read"}`
- **THEN** SHALL 返回 TEAM.md 当前内容（成员列表含 Session 列、任务列表、共享记忆索引）

#### Scenario: assign 动作分配任务给成员
- **WHEN** leader agent 调用 `team` 工具，参数 `{action: "assign", memberName: "alice", title: "实现 auth", description: "..."}`
- **THEN** SHALL 调用 `TeamManager.assignTask`
- **AND** 成员 SHALL 通过 `session.prompt` 或 `session.steer` 收到任务指令

#### Scenario: remove 动作移除并归档成员
- **WHEN** leader agent 调用 `team` 工具，参数 `{action: "remove", memberName: "alice"}`
- **THEN** SHALL 调用 `TeamManager.removeMember`
- **AND** 成员目录 SHALL 被归档到 `_archived/`
- **AND** 成员 session 文件 SHALL 保留在标准 sessions 目录（不删除）

#### Scenario: direct 动作向活跃成员发送指令
- **WHEN** leader agent 调用 `team` 工具，参数 `{action: "direct", memberName: "alice", kind: "directive", payload: "..."}`
- **THEN** SHALL 调用 `TeamManager.directMember`
- **AND** 成员在 streaming 时通过 `steer`，否则通过 `prompt` 接收指令

#### Scenario: edit-member 动作更新成员属性
- **WHEN** leader agent 调用 `team` 工具，参数 `{action: "edit-member", memberName: "alice", goal: "新目标", activeContext: "新上下文"}`
- **THEN** SHALL 更新成员的 goal 或 activeContext 并写入磁盘

#### Scenario: complete 动作标记任务完成
- **WHEN** leader agent 调用 `team` 工具，参数 `{action: "complete", taskId: "T1"}`
- **THEN** SHALL 调用 `TeamManager.completeTask`
- **AND** 成员状态 SHALL 更新为 idle

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

