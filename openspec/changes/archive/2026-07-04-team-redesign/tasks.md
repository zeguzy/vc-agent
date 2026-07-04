## 1. 数据模型 — 新增 TeamMember / TeamTask / TeamMessage 类型

- [x] 1.1 `src/teams/types.ts`: 新增 `TeamMember` / `TeamTask` / `TeamMessage` / `TeamMemberEvent` 类型定义，标记 `WorkerSnapshot` / `WorkerSpawnOptions` / `WorkerEventEnvelope` / `WorkerPoolRef` 为 deprecated
- [x] 1.2 `src/teams/types.ts`: 更新 `TeamConfig` 和 `ResolvedTeamConfig`，新增 member 相关默认值

## 2. TeamSession 核心 — 替换 WorkerSessionPool

- [x] 2.1 `src/teams/manager.ts`: `WorkerSessionPool` → `TeamSession`，新增 `createMember()` / `removeMember()` / `startMember()` / `getMember()` / `listMembers()`，保留 `cancelMember()` / `dispose()`
- [x] 2.2 `src/teams/manager.ts`: 新增 `createTask()` / `assignTask()` / `claimTask()` / `blockTask()` / `listTasks()` / `taskStatus()` 到 TaskPool
- [x] 2.3 `src/teams/manager.ts`: 新增 `sendMessage()` / `readInbox()` 消息路由
- [x] 2.4 `src/teams/manager.ts`: 更新事件转发，`WorkerEventEnvelope` → `TeamMemberEvent`（`type: "team_member_event"`，字段 `memberId` / `memberName`）

## 3. team tool 重设计 — 重写 action 集合

- [x] 3.1 `src/tools/team.ts`: 移除 `spawn` / `continue` action，新增 `create-member` / `assign-task` / `list-members` / `list-tasks` / `task-status` / `send-message` / `read-inbox`
- [x] 3.2 `src/tools/team.ts`: 保留 `poll` / `cancel` action（语义改为 member）
- [x] 3.3 `src/tools/team.ts`: 更新 tool description 和 promptSnippet，展示新的成员协作语义

## 4. System prompt 重写

- [x] 4.1 `src/context-files.ts`: 重写 `TEAM_ORCHESTRATOR_PROMPT`，指导 leader：创建团队 → 组织评审 → 分配任务 → 跟踪进度 → 成员通信

## 5. Server 集成 — AgentServer 适配新接口

- [x] 5.1 `src/server/index.ts`: 添加 V2 handler 方法代理到 WorkerSessionPool
- [ ] 5.2 `src/server/index.ts`: `handleSpawnWorker` → `handleCreateMember`
- [ ] 5.3 `src/server/index.ts`: 更新事件订阅，`team_worker_event` → `team_member_event`
- [ ] 5.4 `src/server/index.ts`: 更新 orphan 处理逻辑适配新成员模型

## 6. Client 接口更新

- [x] 6.1 `src/client/types.ts`: 更新 `AgentClient` team 接口（`createMember` / `assignTask` / `sendMessage` 等）
- [x] 6.2 `src/client/in-process.ts`: 更新实现适配 `TeamSession` 新接口
- [ ] 6.3 废弃的 `spawnWorker` / `cancelWorker` / `listWorkers` 等方法标记 deprecated 但保留兼容

## 7. TUI 更新

- [ ] 7.1 `src/tui/components/WorkersView.tsx` → `TeamView.tsx`：列表项展示 member（name/role/goal/status），详情视图展示任务和消息
- [ ] 7.2 `src/tui/hooks/useSessionEvents.ts`：`team_worker_event` → `team_member_event`，`workerId` → `memberId`
- [ ] 7.3 `src/tui/components/MessageList.tsx`：`WorkerMessageView` → `MemberMessageView`，展示 member name 和 role
- [ ] 7.4 `src/tui/commands.ts`：更新 `/team` 和 `/workers` 命令适配新接口
- [ ] 7.5 `src/tui/App.tsx`：更新 WorkersView 引用为 TeamView

## 8. 迁移清理与测试

- [ ] 8.1 更新所有 `tests/teams-*.test.ts` 适配新接口
- [ ] 8.2 `bun run check` 全绿（typecheck + lint + test）
- [ ] 8.3 移除所有 deprecated 导出（`WorkerSnapshot` / `WorkerSpawnOptions` / `WorkerEventEnvelope`）
