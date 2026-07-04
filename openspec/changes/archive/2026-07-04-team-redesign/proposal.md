## Why

当前 team 模式在架构上与 subagent 模式无本质区别——`WorkerSessionPool` 只是 `runSubagent` 的异步包装。成员没有身份、没有目标、没有任务池，也不能相互通信。用户无法按需创建任意角色的成员，团队协作感受缺失。

## What Changes

- **BREAKING**: 用 `TeamSession` 替换 `WorkerSessionPool`，引入成员注册、任务池、消息路由、共享上下文
- **BREAKING**: team tool action 重新设计：`create-member` / `assign` / `message` / `poll` / `cancel` — 废弃 `spawn` / `continue` 语义
- **新增 TeamMember 领域模型**：每个成员有 name、goal、role、status、context（对话历史），由 leader 动态创建，不限内置角色
- **新增 TaskPool**：leader 定义任务，系统自动分配给空闲成员，leader 通过结构化 status 跟踪进度
- **新增成员间通信**：成员通过 team channel 相互发送消息（同步/异步），消息对 leader 可见
- **Team orchestrator prompt 重写**：指导 leader 如何创建团队、分解需求、分配任务、组织评审
- **TUI 新增 TeamView**：可视化团队结构、成员状态、任务进度、消息流

## Capabilities

### New Capabilities
- `team-member`: 成员身份系统 — leader 动态创建、配置角色/目标/能力、生命周期管理
- `team-taskpool`: 任务池 — 任务定义、分配（leader 分配或成员认领）、状态跟踪、依赖关系
- `team-communication`: 成员间通信 — team channel 消息收发、消息路由、leader 可见性

### Modified Capabilities
- `team-orchestration`: tool action 重新设计，prompt 重写，编排范式从 spawn/poll 变更为成员管理 + 任务分配
- `worker-pool`: WorkerSessionPool 替换为 TeamSession，废弃 WorkerSnapshot / WorkerSpawnOptions

## Impact

- `src/teams/types.ts` — 新增 TeamMember / TeamTask / TeamMessage 类型，废弃 WorkerSnapshot
- `src/teams/manager.ts` — WorkerSessionPool → TeamSession，重写 spawn/cancel → register/unregister
- `src/tools/team.ts` — 重写 tool actions，移除 spawn/continue，新增 create-member/assign/message
- `src/context-files.ts` — 重写 TEAM_ORCHESTRATOR_PROMPT
- `src/server/index.ts` — handleSpawnWorker → handleCreateMember，取消 orphan 逻辑适配
- `src/client/types.ts` — 更新 AgentClient team 接口
- `src/tui/components/` — WorkersView → TeamView
- `src/tui/hooks/useSessionEvents.ts` — worker 事件处理器适配新事件类型

## Non-goals

- 不实现成员持久化（重启后团队解散）
- 不实现任务依赖图（DAG）— V2
- 不实现成员间的代码合并或冲突解决
- 不实现成员的自动扩缩容
- 不修改 subagent 工具行为
