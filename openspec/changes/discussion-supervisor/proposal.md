## Why

团队讨论模式存在三个结构性问题：(1) Leader 在分配任务后持续轮询成员状态（反复调用 `team(action="read")` + `team(action="wait")`），而非被动等待系统推送的 `member_done` 事件——根因是 `ensureSubscribed` 用 `steer` 注入通知文本，LLM 将其当作"需要行动的新信息"而非"只需知晓的状态通知"；(2) 讨论监督者（Coordinator）只是每轮结束后才被唤醒的无状态调度器，没有议题跟踪、偏移检测和强制拉回能力，导致话题容易跑偏；(3) `team` 工具的 `assign` action 没有 `type` 参数，Leader 无法创建 `type="discussion"` 的任务，讨论模式对 Leader 不可达。

## What Changes

- **Leader 事件驱动等待**：`ensureSubscribed` 中 `member_done` 通知改为结构化系统标记（`[SYSTEM NOTIFICATION — DO NOT ACT]`），非 streaming 时不主动 prompt Leader；`TEAM_ORCHESTRATOR_PROMPT` 增加强等待指令段落，禁止轮询；弱化 `team(action="wait")` 的描述，不鼓励轮询用法
- **Coordinator 升级为 Discussion Supervisor**：新增 `DiscussionPlan`/`AgendaItem` 类型定义；Supervisor prompt 增加议题分解、偏移检测指令、scope 边界定义；新增 `redirect`（强制拉回）和 `summarize`（阶段总结）action；Supervisor 复用同一 session 保持跨轮状态；`redirect` action 用 `directMember(kind="redirect")` 而非 steer 注入
- **team 工具增加 discussion type 参数**：`assign` 和 `assign-batch` action 增加 `type` 参数（`"execution" | "discussion"`，默认 `"execution"`）；`create` 和 `create-batch` 增加 `taskType` 参数；`TeamManagerLike.assignTask` 接口增加 `type` 可选参数
- **讨论任务支持多成员参与**：`TaskState` 增加 `participants: MemberName[]` 字段；新增 `TeamManager.startDiscussion(opts)` 方法，接受 `participants` 数组，创建不绑定单个 member 的讨论任务；Supervisor 管理所有参与者的轮次

## Capabilities

### New Capabilities
- `discussion-supervisor`: 讨论监督者——议题跟踪、偏移检测、redirect 强制拉回、跨轮状态保持、多成员讨论管理

### Modified Capabilities
- `team-orchestration`: Leader 等待语义增强（禁止轮询、结构化通知）、team 工具增加 discussion type 参数、assignTask 接口扩展

## Non-goals

- 不改动 Pi SDK 内部逻辑（steer/prompt 语义不变）
- 不改动 member 的 system prompt 层级结构（L1-L5 不变）
- 不实现讨论结果的自动持久化（讨论结论仍由 Leader 决定是否写入 memory）
- 不实现 Supervisor 的 compaction（长讨论 context 膨胀问题留后续迭代）
- 不实现讨论的实时 UI 展示（TUI 讨论面板留后续迭代）
- 不改变 `team(action="wait")` 的实现逻辑（只改 prompt 描述弱化轮询鼓励）

## Impact

- `src/server/index.ts`：`ensureSubscribed` 中 `member_done`/`member_error` 通知格式变更
- `src/context-files.ts`：`TEAM_ORCHESTRATOR_PROMPT` 增加"Waiting for Your Team"段落，`team` 工具 description 更新
- `src/tools/team.ts`：`TeamParamsSchema` 增加 `type`/`taskType` 参数，`handleAssign`/`handleAssignBatch`/`handleCreate`/`handleCreateBatch` 透传 type
- `src/teams/coordinator.ts`：全面重构为 `DiscussionSupervisor`，新增类型定义和增强 prompt
- `src/teams/manager-v2.ts`：`assignTask` 接口增加 type 参数，新增 `startDiscussion` 方法，`doEvaluateDiscussion` 适配 Supervisor 新决策类型，`TaskState` 增加 participants 字段
- `src/teams/types-v2.ts`：`TaskState` 增加 `participants` 字段，`TeamManagerLike` 接口增加 `startDiscussion` 方法
- `src/teams/files.ts`：TEAM.md 解析/写入适配 participants 字段
- `src/client/types.ts`：`AgentClient.assignTask` 增加 type 参数
- `src/client/in-process.ts`/`src/client/http.ts`：透传 type 参数
- `tests/team-discussion-*.test.ts`：适配新 Supervisor 接口
