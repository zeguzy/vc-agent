## Why

openagent 已有同步 `subagent` 工具（single/parallel/chain）和 orchestrator system prompt，能在一次工具调用内**阻塞**主 agent 等待并行子任务返回 summary。这覆盖了"一次性研究/审查"场景，但无法支撑"主 agent 派活后继续推进其他事，worker 在后台跑完再回来汇总"这类真正的 team 协作模式。

参考 Claude Code 的 Subagents vs Agent Teams 分层（独立 context window + per-agent 工具收口 + summary 回传），我们计划先落地 **Claude Code Subagents 增强版**：把同步委派升级为**后台异步 worker**，让主 agent 能 spawn → 继续做别的事 → poll 回收，并在 TUI 内独立流式展示每个 worker 的输出。mailbox / 共享 task list / git worktree 隔离等 P2P 能力是后续 V2 的事。

## What Changes

- 新增 `src/teams/{types,worker,manager}.ts`：异步 worker session pool，每个 worker 独立 `createAgentSession`、独立 event 总线、可 cancel / dispose
- 新增 `src/tools/team.ts`：暴露 `spawn / poll / cancel` 三个动作给主 agent；现有同步 `subagent` 工具保持不动
- 扩展 `src/agents/discover.ts` 与 `src/agents/types.ts` 解析 frontmatter 新字段：`disallowedTools` / `maxTurns` / `background` / `permissionMode`
- 扩展 `src/context-files.ts`：team orchestrator system prompt（指导主 agent spawn 后继续推进、poll 回收、综合结果）
- 扩展 `src/config.ts`：新增 `Config.teams` 配置块（enabled / defaultWorkerModel / maxWorkers / defaultMaxTurns / isolation）
- 改造 `src/server/index.ts`：`AgentServer` 持有 `WorkerSessionPool`，worker 事件打 `workerId` 标签后转发给主订阅者
- 扩展 `src/client/types.ts` + `src/client/in-process.ts`：`AgentClient` 新增 `listWorkers / getWorker / sendToWorker / cancelWorker / onWorkerEvent`
- 扩展 `src/message.ts`：新增 `worker` / `worker-summary` 角色与 `workerId / workerAgent / workerStatus` 元数据
- 扩展 `src/tui/components/MessageList.tsx` 与新增 `src/tui/components/WorkersView.tsx`：默认 inline 聚合展示并行 worker 流式输出；`/workers` 命令进入选择器聚焦查看单个 worker 历史
- 扩展 `src/tui/commands.ts`：新增 `/team spawn /team poll /workers` 等命令

## Capabilities

### New Capabilities

- `worker-pool`: 后台异步 worker session 池——独立 context、生命周期管理（spawn/cancel/dispose）、事件聚合路由、并发与资源上限
- `team-orchestration`: 面向主 agent 的 `team` 工具（spawn/poll/cancel）、team orchestrator system prompt、`/team` 系 slash 命令——主 agent 异步委派 + 继续 + 回收的协作范式

### Modified Capabilities

- `agent-session`: 扩展 agent 定义 frontmatter 解析，新增 `disallowedTools` / `maxTurns` / `background` / `permissionMode` 字段（仅 `background: true` 的 agent 才能作为 team worker 被异步 spawn）
- `tui-messages`: 新增 `worker` / `worker-summary` 消息角色，新增并行 worker 流式输出渲染
- `settings`: 新增 `teams` 配置块（enabled / defaultWorkerModel / maxWorkers / defaultMaxTurns / isolation / workerPermissions）

## Impact

- **新增目录**：`src/teams/`（types/worker/manager/prompt）
- **新增文件**：`src/tools/team.ts`、`src/tui/components/WorkersView.tsx`
- **修改文件**：`src/agents/{discover,types}.ts`、`src/context-files.ts`、`src/config.ts`、`src/server/index.ts`、`src/client/{types,in-process}.ts`、`src/client/http.ts`（如需远程模式）、`src/message.ts`、`src/tui/components/MessageList.tsx`、`src/tui/commands.ts`、`src/agents/runner.ts`（抽出独立 session 工厂复用）
- **依赖**：无新增 npm 依赖；复用 `@earendil-works/pi-coding-agent` 的 `createAgentSession` / `DefaultResourceLoader`
- **风险**：进程退出时必须 dispose 所有 worker（孤儿 session 风险）；并发上限硬执行；worker 默认 `disallowedTools: write, edit`（最小权限基线）
- **影响范围**：TUI、headless runner、HTTP serve+attach 三种运行模式均需路由 worker 事件

## Non-goals

V1 明确**不做**以下能力（留待 V2）：

- **worker 间 mailbox / 直接 P2P 通信**——Claude Code Agent Teams 自己都未解决 task 状态滞后阻塞依赖的问题，本地终端场景价值低
- **共享 task list 与任务依赖图**——V1 worker 只向主 agent 回 summary，无共享看板
- **git worktree 隔离**——V1 所有 worker 共享同一 cwd，文件冲突由"worker 默认只读"防御；worktree 隔离放 V2
- **per-agent MCP server**——MCP 整体尚未在 openagent 落地（仅在 openspec archive 有设计），team 模式不耦合
- **split-pane / tmux 多终端展示**——V1 在主 TUI 内做 inline 聚合 + 选择器聚焦两种渲染模式
- **worker 持久化与断电恢复**——worker session 不进入 `SessionManager` 持久化列表，dispose 即清（与现有同步 subagent 一致）
- **嵌套 team**——worker 不能再 spawn 自己的 team，避免无限递归
- **resume 单个 worker**——V1 仅支持 team 级别的 cancel_all，不单独 resume worker
- **完整 cost tracking per worker**——V1 仅暴露 token/cost 给主 agent 在 poll 时聚合查看，不做独立账单