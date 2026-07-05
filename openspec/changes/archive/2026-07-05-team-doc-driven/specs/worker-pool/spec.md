## MODIFIED Requirements

### Requirement: TeamManager 替代 WorkerSessionPool

系统 SHALL 用 `TeamManager`（`src/teams/manager.ts`）替代 `WorkerSessionPool`，接口从 `WorkerSessionPoolLike` 改为 `TeamManagerLike`。TeamManager 以 `.openagent/team/` 目录下的 Markdown 文件为状态来源，不再使用内存 Map + JSON 持久化。

#### Scenario: TeamManager 创建
- **WHEN** `AgentServer` 初始化时创建 TeamManager
- **THEN** SHALL 接收 `ResolvedTeamConfig`、`SubagentServices`、`cwd` 参数
- **AND** SHALL 初始化 `.openagent/team/` 目录（如不存在）
- **AND** SHALL 读取或创建 `TEAM.md`

#### Scenario: TeamManager 创建 member
- **WHEN** leader 通过 `team-edit` 添加新 member
- **THEN** SHALL 通过 `createAgentSession()` 创建独立会话，配置 `appendSystemPrompt: [L1+L2+L3]`
- **AND** SHALL 创建 `members/<name>.md` 索引文件
- **AND** SHALL 创建 `members/<name>/` 目录
- **AND** SHALL 更新 TEAM.md Members 表

#### Scenario: TeamManager 分配任务
- **WHEN** leader 通过 `team-edit` 分配任务给 member
- **THEN** SHALL 通过 `steer()` 或 `prompt()` 注入 L4（Tasks）
- **AND** SHALL 更新 TEAM.md Active Tasks
- **AND** SHALL 更新 member .md 的 Active Context

#### Scenario: TeamManager 处理 member 完成
- **WHEN** member session 触发 `agent_end` 事件
- **THEN** SHALL 更新 TEAM.md Members 表（status → idle/done）
- **AND** SHALL 更新 TEAM.md Active Tasks（checkbox 勾选）
- **AND** SHALL 通知 leader（steer/prompt `[Member <name> completed <task>]`）
- **AND** member session SHALL NOT 被 dispose（保留以接受新任务）

#### Scenario: TeamManager dispose
- **WHEN** Bun 进程退出或 TeamManager.dispose() 被调用
- **THEN** SHALL 对所有 member session 调用 `session.dispose()`
- **AND** SHALL NOT 删除 `.openagent/team/` 目录（记忆文件持久保留）

### Requirement: Member 生命周期与 Agent Session 对齐

系统 SHALL 保证 member 的生命周期与 Agent Session 相同——member 创建后持续存在，直到被显式移除或进程退出。

#### Scenario: member 完成任务后保持 active
- **WHEN** member 完成当前任务（agent_end 事件）
- **THEN** member session SHALL 保持 active 状态
- **AND** member SHALL 可接受新任务（通过 steer/prompt 注入 L4）

#### Scenario: member 被移除
- **WHEN** leader 通过 `team-edit` 移除 member
- **THEN** SHALL 调用 member session.dispose()
- **AND** SHALL 将 `members/<name>/` 目录移至 `members/_archived/<name>/`
- **AND** SHALL 更新 TEAM.md Members 表移除该行

#### Scenario: member 并发上限
- **WHEN** active member 数量 >= `Config.teams.maxWorkers`（默认 4）
- **AND** leader 尝试添加新 member
- **THEN** SHALL 返回错误 `team capacity exhausted: maxWorkers=N reached`

## REMOVED Requirements

### Requirement: Worker session pool 生命周期管理
**Reason**: WorkerSessionPool 被 TeamManager 替代，member 概念替代 worker 概念
**Migration**: 使用 TeamManager 创建/管理 member，member 生命周期与 Agent Session 对齐

### Requirement: Worker maxTurns 硬上限
**Reason**: member 生命周期与 Agent Session 对齐，不再需要 maxTurns 限制；member 完成任务后保持 active 可接受新任务
**Migration**: 由 leader 通过 team-edit 分配/取消任务控制 member 工作量

### Requirement: Worker 事件聚合与路由
**Reason**: 事件路由逻辑集成到 TeamManager，不再需要独立的 WorkerEventEnvelope 聚合
**Migration**: TeamManager 直接订阅 member session 事件，通过 TeamManagerLike 接口暴露

### Requirement: 主 agent 结束时孤儿 worker 处理
**Reason**: member 生命周期与主 agent 对齐，不再存在"孤儿"概念；leader 结束时所有 member 自动 dispose
**Migration**: TeamManager.dispose() 在进程退出时统一调用

### Requirement: 主 session 切换时孤儿 worker 处理
**Reason**: 同上，member 与 session 生命周期对齐
**Migration**: session 切换时 TeamManager.dispose() 所有 member，重新初始化 TeamManager
