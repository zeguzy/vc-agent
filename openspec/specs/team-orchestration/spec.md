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

### Requirement: team 工具支持 create-batch 批量创建成员

系统 SHALL 在 `team` 工具的 `action` 联合类型中新增 `"create-batch"` 字面量。该 action 接受一个 `members` 数组参数，每项结构为 `{ name: string, role: string, goal: string, taskTitle?: string, taskDescription?: string, taskPriority?: "high" | "medium" | "low" }`，在一次工具调用内创建多个成员。批量逻辑全部位于 `src/tools/team.ts` 的 tool 层，循环调用既有 `TeamManager.createMember`（单条接口语义不变），每个成员在创建成功后若提供 `taskTitle` 则立即调用 `TeamManager.assignTask` 分配初始任务。原 `action="create"` 单成员行为 SHALL 保持完全向后兼容。

#### Scenario: 容量预检通过，全部成员创建成功

- **WHEN** leader agent 调用 `team` 工具，参数 `{ action: "create-batch", members: [{ name: "alice", role: "frontend", goal: "UI" }, { name: "bob", role: "backend", goal: "API", taskTitle: "design schema", taskDescription: "..." }] }`
- **AND** 当前成员数 + `members.length` ≤ `config.maxWorkers`
- **THEN** 系统 SHALL 对 `members` 数组顺序调用 `TeamManager.createMember`
- **AND** 对每个提供 `taskTitle` 的成员 SHALL 紧接着调用 `TeamManager.assignTask`，使用与 `createMember` 独立的 try/catch
- **AND** 系统 SHALL 返回汇总文本，使用固定三桶格式（参见 design D6）：`Created N member(s):` 段每行 `✓ <name> (<role>) [T<id>]` 或 `✓ <name> (<role>) — no task`；`Failed 0 member(s):` 段省略或留空
- **AND** 提供了 taskTitle 的成员行 SHALL 包含分配的 taskId

#### Scenario: 容量预检失败，整批拒绝

- **WHEN** leader agent 调用 `team` 工具，参数 `members` 数组长度为 N
- **AND** 当前 `TeamManager.members.size` + N > `config.maxWorkers`
- **THEN** 系统 SHALL 在调用任何 `createMember` 之前返回错误
- **AND** 系统 SHALL NOT 创建任何成员
- **AND** 系统 SHALL 在错误信息中说明当前成员数、批量大小、maxWorkers 上限

#### Scenario: 部分成员 createMember 失败，其他成员仍被创建

- **WHEN** `members` 数组中存在重名成员（与现有成员或数组内其他项冲突）或 `validateName` 失败的非法名字
- **AND** 容量预检已通过
- **THEN** 系统 SHALL 对每个成员独立尝试 `createMember`，使用独立的 try/catch 包裹
- **AND** 单个 `createMember` 失败 SHALL NOT 中断后续成员的创建
- **AND** 失败成员 SHALL 进入 failed 桶，汇总行格式 `✗ <name>: <error message>`
- **AND** 成员未被写入 `TeamManager.members` 或磁盘（`createMember` 在状态修改前抛错）

#### Scenario: createMember 成功但 assignTask 失败时归为成功桶（带 warn）

- **WHEN** 某成员的 `createMember` 成功（已写入 `members` Map 与 `TEAM.md`）
- **AND** 该成员提供了 `taskTitle` 但后续 `assignTask` 抛错
- **THEN** 系统 SHALL 使用独立的 try/catch 包裹 `assignTask`，与 `createMember` 的 try/catch 分离
- **AND** 该成员 SHALL 进入 succeeded 桶（不可归为 failed），汇总行格式 `✓ <name> (<role>) — task error: <msg>`
- **AND** 该行 SHALL NOT 包含 taskId（任务未分配成功）
- **THEN** 此设计保证 Leader 重试创建该成员时会撞 `members.has(name)` 的 "already exists" 错误，而不是再次误判为 failed

#### Scenario: members 数组为空或缺失

- **WHEN** leader agent 调用 `{ action: "create-batch" }` 且未提供 `members`，或 `members` 为空数组
- **THEN** 系统 SHALL 返回错误信息提示 `members` 数组为必填且不能为空
- **AND** 系统 SHALL NOT 调用任何 `createMember`

#### Scenario: members 数组超出软上限

- **WHEN** `members.length` 超过 tool 层定义的软上限（默认 20）
- **THEN** 系统 SHALL 返回错误信息，提示建议拆分多次调用或调高软上限
- **AND** 系统 SHALL NOT 创建任何成员

#### Scenario: create 单成员行为保持不变

- **WHEN** leader agent 调用 `{ action: "create", name, role, goal, ... }`（不带 `members`）
- **THEN** 系统 SHALL 走原有 `handleCreate` 路径，行为与引入 `create-batch` 前完全一致
- **AND** 系统 SHALL NOT 校验或消费 `members` 字段

### Requirement: ORCHESTRATOR_SYSTEM_PROMPT 包含 Never delegate understanding 反例教学

`ORCHESTRATOR_SYSTEM_PROMPT`（定义于 `src/context-files.ts`）SHALL 包含一个名为 "Never delegate understanding" 的段落，明确禁止把 subagent 研究结果直接转发为执行委托的懒惰行为。该段落 SHALL 包含：(a) 一条原则声明（coordinator 必须读完研究结果、识别方法、写出含具体文件路径+行号的委托 prompt）；(b) 至少一组 ❌ 反例（如 "based on your findings, fix the bug"）和 ✅ 正例对照；(c) **强化已有的 "3 行硬约束"**（ORCHESTRATOR_SYSTEM_PROMPT L52 已有 "If your delegation prompt is shorter than 3 lines, it is too vague"，本 requirement 是把这条规则纳入 "Never delegate understanding" 段落并补反例上下文，不是新增规则）。

#### Scenario: orchestrator 收到 flagella 研究结果后产出含具体路径的委托

- **WHEN** orchestrator 模式激活，且 orchestrator 刚收到 flagella 的研究结果（含文件路径、调用链分析）
- **THEN** orchestrator 后续对 ribosome/nucleus 的委托 prompt SHALL 包含具体的文件路径（如 `src/auth/validate.ts:42`）
- **AND** SHALL 包含明确的修改指令（如 "add null check before user.id access"）
- **AND** SHALL NOT 是 "based on your findings, fix the bug" 这类无具体路径的转发式委托

#### Scenario: orchestrator 委托 prompt 过短时被强化后的规则阻断

- **WHEN** orchestrator 准备发送一个少于 3 行的委托 prompt，且此前已收到过研究结果
- **THEN** "Never delegate understanding" 段落（含被纳入的已有 3 行硬约束 + 新增反例教学）SHALL 让 orchestrator 先停下来合成研究结果，再写完整委托
- **AND** 最终委托 prompt SHALL 含研究结论中的具体细节（路径/行号/模式名）

### Requirement: lysosome agent 定义为对抗性验证

`lysosome`（定义于 `src/agents/defaults.ts:BUILTIN_AGENTS`）的 `systemPrompt` SHALL 表达"对抗性验证"哲学——其职责是"试图证伪"实现，而非"系统性检查清单"。该 systemPrompt SHALL 强制要求：(a) 输出末尾必须有形如 `VERDICT: PASS` 或 `VERDICT: FAIL` 或 `VERDICT: PARTIAL` 的判定行，缺失该行则响应视为无效；(b) 列出至少 6 种自我合理化借口（如 "the code looks correct → reading is not verification"）让 lysosome 在自检时识别；(c) PASS 必须附带实际运行的验证命令及结果（tsc/biome/bun test 等），禁止仅凭阅读代码放行；(d) FAIL 必须为每个 broken claim 提供反例。

**注**：当前 lysosome 输出 `APPROVE / REQUEST_CHANGES / NEEDS_DISCUSSION`（defaults.ts L194-195），经 grep 在 `src/` 和 `tests/` 下确认**无任何下游代码解析这些词**，可安全替换为 `PASS / FAIL / PARTIAL`（含新增的 PARTIAL 状态）。

#### Scenario: lysosome 审查含类型抑制的代码

- **WHEN** orchestrator 调用 `subagent({ mode: "single", agent: "lysosome", description: "review src/auth/login.ts" })`，且该文件含 `as any` 或 `@ts-ignore`
- **THEN** lysosome 输出 SHALL 包含 `VERDICT: FAIL` 行
- **AND** Findings 段 SHALL 包含至少一个 `[CRITICAL]` 标签项，引用具体行号
- **AND** SHALL NOT 包含 `VERDICT: PASS`（即使代码"看起来"逻辑正确）
- **AND** SHALL NOT 包含旧的 `APPROVE` 词（已替换）

#### Scenario: lysosome PASS 必须附带验证命令证据

- **WHEN** lysosome 准备输出 `VERDICT: PASS`
- **THEN** 输出 SHALL 包含一个 Evidence 段，列出实际运行的验证命令（如 `tsc --noEmit`、`bun test`）
- **AND** 每条命令 SHALL 附带实际结果（如 "tsc: pass", "test: 42 pass"）
- **AND** SHALL NOT 仅凭阅读代码就输出 PASS

#### Scenario: lysosome 验证工具不可用时输出 PARTIAL

- **WHEN** lysosome 被要求审查代码，但项目无 tsc/biome/test 配置（无法运行验证命令）
- **THEN** lysosome SHALL 输出 `VERDICT: PARTIAL`
- **AND** SHALL 显式列出"unverified"项（如 "type safety: unverified (no tsc available)"）
- **AND** SHALL NOT 输出 PASS

#### Scenario: lysosome 识别自我合理化借口

- **WHEN** lysosome 在分析过程中产生 "the code looks correct" 或 "tests should pass" 这类未经验证的判断
- **THEN** systemPrompt 的自我合理化借口清单 SHALL 触发 lysosome 自我纠正
- **AND** lysosome SHALL 实际运行验证命令或显式标记为 unverified

