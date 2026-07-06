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

### Requirement: Team member L1 身份层行为契约

系统 SHALL 在 `src/teams/context.ts` 的 `buildIdentityLayer` 函数中，将 team member 的 L1 身份层从单段字符串升级为七个结构化分区，按以下顺序拼装：

1. **Identity** — `You are {name}, a {role} on this team. Your goal: {goal}.` 若 leader 提供了 constraints，SHALL 在 Identity 段末尾追加一行指引"你的行为约束见下方 Anti-Patterns 段"（不重复 constraints 内容）。
2. **Capabilities** — 列出 member 可用工具（`read` / `bash` / `grep` / `find` / `memory`）及使用原则，MUST 包含"验证优先于声称（reading is not verification）"原则。
3. **Work Discipline** — 描述工作流程：接 task → 理解 scope → 执行 → 验证 → 报告，MUST 强调执行前先读 task description、执行后必须验证。
4. **Anti-Patterns** — MUST 包含通用兜底约束（至少覆盖：scope creep / 不验证就报告 / 重复 leader 已做的事 / 擅自改 team 文件 四类）。**constraints 文本 SHALL 只注入此分区一次**（不重复出现在 Identity）。若 leader 通过 `constraints` 参数提供了 role-specific 约束，SHALL 在通用约束后追加定制约束。
5. **Escalation** — MUST 定义四种状态码（`DONE` / `DONE_WITH_CONCERNS` / `BLOCKED` / `NEEDS_CONTEXT`）及各自的触发条件。
6. **Output Protocol** — MUST 要求完成时返回结构化报告：Status（四种状态码之一）+ Summary（简洁摘要）+ Key files（触及的文件路径）+ Evidence（验证证据，如运行的命令及结果）。
7. **Memory Discipline** — MUST 指导 member 何时使用 `memory(action="write")`（学到新模式 / 踩过的坑 / 用户偏好）。

`buildIdentityLayer` SHALL 移除 `agentSystemPrompt` 形参（dead parameter，无调用方传入）。每个分区 SHALL 作为独立 string export 常量定义（Anti-Patterns 为函数，因接受 customConstraints），便于单元测试和未来维护。

#### Scenario: L1 包含全部七个分区

- **WHEN** 调用 `buildIdentityLayer({ name: "alice", role: "reviewer", goal: "审查代码" })` 且未提供 constraints
- **THEN** 返回的字符串 SHALL 包含全部七个分区标题或关键词（Identity / Capabilities / Work Discipline / Anti-Patterns / Escalation / Output Protocol / Memory Discipline）
- **AND** Anti-Patterns 段 SHALL 包含通用兜底约束（含 scope creep / 不验证就报告 / 重复 leader 工作 / 擅自改 team 文件）
- **AND** 字符串 SHALL NOT 包含 `agentSystemPrompt` 相关内容（该 dead parameter 已移除）

#### Scenario: leader 提供 constraints 时只拼入 Anti-Patterns 段

- **WHEN** 调用 `buildIdentityLayer({ name: "bob", role: "implementer", goal: "...", constraints: "不许跳过测试；每个改动必须跑 bun test" })`
- **THEN** Anti-Patterns 段 SHALL 在通用兜底约束之后追加 leader 提供的 constraints 文本
- **AND** Identity 段 SHALL 仅追加一行"行为约束见下方 Anti-Patterns 段"指引（不重复 constraints 文本）
- **AND** constraints 文本 SHALL 在整个 L1 中只出现一次（仅在 Anti-Patterns 段）
- **AND** 其他六个分区内容与未提供 constraints 时一致

#### Scenario: buildMemberSystemPrompt 返回 L1+L2+L3 三元素数组

- **WHEN** 调用 `buildMemberSystemPrompt({ role, goal, name, constraints, memberIndex, teamMd, selfName })`
- **THEN** 返回值 SHALL 为三元素 string 数组：`[L1, L2, L3]`
- **AND** L1（首元素）SHALL 为 `buildIdentityLayer` 的输出（含七分区）
- **AND** L2/L3 与当前实现一致（buildMemoryIndexLayer / buildTeamSummaryLayer 输出不变）

#### Scenario: 不传 constraints 时退化通用兜底

- **WHEN** `createMember` 调用时未提供 `constraints` 参数（或提供空字符串）
- **THEN** `buildIdentityLayer` SHALL 仅使用通用兜底 Anti-Patterns，不追加定制约束
- **AND** Identity 段 SHALL NOT 包含"行为约束见下方"指引（因无定制约束）
- **AND** 行为 SHALL 与本 change 引入前的调用方完全兼容（现有 team 工具不传 constraints 时仍正常工作）

### Requirement: createMember 接口接受可选 constraints 参数

`TeamManager.createMember`（含接口 `TeamManagerLike.createMember`）的 opts 参数 SHALL 新增可选字段 `constraints?: string`。该字段 SHALL 透传给 `buildMemberSystemPrompt` → `buildIdentityLayer`，用于在 Anti-Patterns 分区注入 role-specific 行为约束。

`MemberIndexStructure` SHALL 在顶层（不放 profile）新增可选字段 `constraints?: string` 用于持久化。`MemberState` SHALL NOT 持有 constraints（constraints 是创建时数据，runtime 通过 member index 访问）。

`createMember` SHALL 在调用 `files.initMemberDir` 前对 constraints 做校验：长度超过 800 字符 SHALL 截断到 800；含 `## ` 开头的行 SHALL 移除这些行（防止破坏 markdown section 解析）。校验后的 constraints SHALL 写入 member .md 的 `## Constraints` section（位于 `## Profile` 之后、`## Active Context` 之前）。

`restoreMembers` SHALL 从 `memberIndex.constraints`（由 `parseMemberIndex` 从 `## Constraints` section 读取）透传给 `buildMemberSystemPrompt`。读取时若 constraints 字段缺失或 section 不存在，SHALL 按未提供处理（退化通用兜底），不阻断 restore。

`team` 工具的 `TeamParamsSchema` SHALL 新增可选字段 `constraints`。`BatchMemberSchema`（create-batch 用）SHALL 同步新增可选字段 `constraints`，支持 per-member 独立传入。`handleCreate` 和 `handleCreateBatch` SHALL 将 args.constraints 透传给 `manager.createMember`。

客户端接口（`AgentClient.createMember`、`InProcessClient.createMember`、`HttpClient` 的 `/team/members` POST body）SHALL 同步接受并透传 `constraints` 字段。

#### Scenario: createMember 透传 constraints 到 prompt

- **WHEN** leader 调用 `team` 工具，参数 `{ action: "create", name: "kim", role: "reviewer", goal: "审查", constraints: "must run tests, no rubber-stamping" }`
- **THEN** `handleCreate` SHALL 调用 `manager.createMember({ name, role, goal, constraints: "must run tests, ...", ... })`
- **AND** `createMember` SHALL 将 constraints 透传给 `buildMemberSystemPrompt`
- **AND** 最终 member session 的 system prompt SHALL 在 Anti-Patterns 段含 "must run tests, no rubber-stamping"

#### Scenario: constraints 持久化到 member .md 的 ## Constraints section

- **WHEN** `createMember` 提供 constraints 参数（经校验后）
- **THEN** `files.initMemberDir` SHALL 在 member .md 写入 `## Constraints` section（位于 `## Profile` 之后、`## Active Context` 之前）
- **AND** section body SHALL 为 constraints 文本（多行自由文本）
- **AND** `parseMemberIndex` SHALL 通过 `sections.get("Constraints")` 读取到 `memberIndex.constraints`（顶层字段，不放 profile）

#### Scenario: constraints 长度超限被截断

- **WHEN** `createMember` 收到长度 > 800 字符的 constraints
- **THEN** 系统 SHALL 截断 constraints 到 800 字符（不拒绝创建）
- **AND** 截断后的 constraints SHALL 正常写入 `## Constraints` section 并注入 prompt

#### Scenario: constraints 含 ## 开头的行被清理

- **WHEN** `createMember` 收到含 `## some heading` 行的 constraints
- **THEN** 系统 SHALL 移除所有以 `## ` 开头的行（防止破坏 `splitSections` 解析）
- **AND** 清理后的 constraints SHALL 正常写入 `## Constraints` section

#### Scenario: restore 重建含 constraints 的 L1

- **WHEN** 进程重启，`restoreMembers` 从 member .md 读到 `constraints: "must run tests, ..."`
- **THEN** `restoreMembers` SHALL 调用 `buildMemberSystemPrompt({ role, goal, name, constraints: "must run tests, ...", ... })`
- **AND** 重建的 member session system prompt SHALL 与创建时一致（含定制 Anti-Patterns）

#### Scenario: restore 时 ## Constraints section 不存在

- **WHEN** `restoreMembers` 读取旧 member .md（无 `## Constraints` section）
- **THEN** `parseMemberIndex` SHALL 返回 `constraints: undefined`（`sections.get("Constraints")` 返回 undefined）
- **AND** `restoreMembers` SHALL 调用 `buildMemberSystemPrompt` 时不传 constraints
- **AND** 重建的 L1 SHALL 使用通用兜底 Anti-Patterns（行为正常，不阻断 restore）

#### Scenario: create-batch per-member 独立透传 constraints

- **WHEN** leader 调用 `team` 工具，参数 `{ action: "create-batch", members: [{ name: "alice", role: "frontend", goal: "UI", constraints: "不许跳过 lint" }, { name: "bob", role: "backend", goal: "API" }] }`
- **THEN** `handleCreateBatch` SHALL 对 alice 调用 `createMember` 时透传 `constraints: "不许跳过 lint"`
- **AND** SHALL 对 bob 调用 `createMember` 时不传 constraints（bob 未提供）
- **AND** 每个 member 的 L1 SHALL 独立按各自 constraints 情况构建

#### Scenario: HTTP 客户端透传 constraints

- **WHEN** `HttpClient.createMember({ name, role, goal, constraints })` 发送 POST `/team/members`
- **THEN** 请求 body SHALL 包含 `constraints` 字段
- **AND** 服务端 `handleCreateMember` SHALL 将 constraints 透传给 `manager.createMember`
