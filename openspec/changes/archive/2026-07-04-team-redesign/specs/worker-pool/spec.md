## MODIFIED Requirements

### Requirement: Team session 生命周期管理

系统 SHALL 在 `src/teams/manager.ts:TeamSession` 维护一组团队成员，提供 `createMember` / `removeMember` / `getMember` / `listMembers` / `cancelMember` / `dispose` 接口。每个成员持有一个独立 Pi SDK `AgentSession`，成员不写入 `SessionManager` 持久化列表，dispose 即清。

#### Scenario: 创建并启动成员
- **WHEN** leader 调用 `team.create-member` 传入 `{name: "Alice", role: "前端开发", goal: "实现登录页", model: "deepseek-v4-pro"}`
- **THEN** `TeamSession.createMember` SHALL 生成 `mem_<8 char base32>` id 并存入 members map
- **AND** SHALL 返回 `{memberId, name, status: "idle"}`，不立即启动 session
- **AND** 后续 `assign-task` 时 SHALL 创建独立 AgentSession 并调用 `session.prompt(task)`

#### Scenario: 同时运行成员数上限
- **WHEN** `TeamSession.listMembers().filter(w => w.status === "working").length >= Config.teams.maxWorkers`（默认 4）
- **AND** leader 试图 assign-task 给新成员
- **THEN** SHALL 返回错误 `"team capacity full: maxWorkers=N reached"`
- **AND** 任务仍被创建（状态为 assigned），但成员不启动

#### Scenario: 进程退出 disposeAll
- **WHEN** Bun 进程收到 SIGINT/SIGTERM 或 process.on("exit")
- **THEN** `TeamSession` SHALL 遍历所有成员的 session，调用 `session.dispose()`
- **AND** dispose 失败不阻塞其他成员释放

### Requirement: Member maxTurns 硬上限

系统 SHALL 为每个成员实例化时设置 `maxTurns`（取 agent frontmatter `maxTurns`，否则 `Config.teams.defaultMaxTurns`，默认 8）。成员 turn 计数达到上限时 SHALL 强制中止并标记为 error。

#### Scenario: 命中 maxTurns 自动中止
- **WHEN** 成员收到 `message_end` 事件累计的 turn 计数 ≥ member.maxTurns
- **THEN** SHALL 调用 `session.abort()` 中止下一轮
- **AND** SHALL 置成员状态为 `error`，lastSummary 标注 `"hit_maxTurns (N)"`

### Requirement: 成员事件聚合与路由

系统 SHALL 通过 `TeamSession.subscribe(listener)` 暴露事件聚合接口，成员的 Pi SDK 事件经包装为 `TeamMemberEvent` 后转发给所有订阅者。事件类型标识为 `type: "team_member_event"`（替换旧的 `team_worker_event`）。

#### Scenario: 成员 message_delta 转发
- **WHEN** 某成员的 session 收到 `message_update` 事件
- **THEN** `TeamSession` SHALL 转发 `TeamMemberEvent { type: "team_member_event", memberId, memberName, kind: "message_delta", payload: <原始 SDK event> }`

#### Scenario: 成员 agent_end 转发
- **WHEN** 成员收到 `agent_end` 事件
- **THEN** SHALL 转发 `kind: "agent_end"`，并置成员状态为 `done`
- **AND** SHALL 提取 assistant 最终文本作为 lastSummary
- **AND** 自动将关联任务标记为 done，若有待办任务则启动下一个

## REMOVED Requirements

### Requirement: Worker session pool 生命周期管理

**Reason**: `WorkerSessionPool` 和 `Worker` 类被 `TeamSession` 和 `TeamMember` 模型替代。新模型增加了成员身份、任务池、消息通信能力。

**Migration**: 引用 `WorkerSessionPool` 的代码改引用 `TeamSession`。`WorkerSnapshot` 废弃，改用 `TeamMember` 的 status getter。`workerId` 格式 `wkr_xxx` → `memberId` 格式 `mem_xxx`。

### Requirement: Worker maxTurns 硬上限

**Reason**: 功能保留，归属到 Member 的 maxTurns 管理中，语义一致。

**Migration**: 无用户侧变化，仅内部重命名。

### Requirement: Worker 事件聚合与路由

**Reason**: 事件类型从 `team_worker_event` 更新为 `team_member_event`，payload 字段从 `workerId/workerAgent` 改为 `memberId/memberName`。

**Migration**: TUI 端 `useSessionEvents` 中 `event.workerId` → `event.memberId`，`event.workerAgent` → `event.memberName`。
