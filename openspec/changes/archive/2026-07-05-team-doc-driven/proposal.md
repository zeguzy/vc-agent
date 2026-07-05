## Why

当前团队系统（WorkerSessionPool + TeamStorage）使用 JSON 持久化和内存 Map 管理状态，存在三个核心问题：(1) **无记忆**——member 完成任务后上下文丢失，无法跨任务积累经验；(2) **状态与代码耦合**——member/task/message 状态分散在 Map + JSON 文件中，难以审计和调试；(3) **上下文注入粗糙**——仅靠 system prompt 段落和 steer/prompt 注入，无法按需加载细粒度信息，导致上下文浪费或关键信息缺失。

Claude Code CLI 的三层记忆系统（MEMORY.md 索引 + topic .md 文件 + 四类分类）验证了"文档即状态"的可行性。本提案将其核心理念移植到我们的团队系统中，用 Markdown 文件替代 JSON 持久化，用分层上下文注入替代粗糙的 system prompt 拼接。

## What Changes

- **BREAKING**: 移除 `WorkerSessionPool` + `TeamStorage`，替换为 `TeamManager`（文档驱动的团队管理器）
- **BREAKING**: 移除 V1 worker 概念（spawn/poll/cancel），统一为 member 概念（member ≈ Agent Session）
- 新增 `.openagent/team/` 目录结构：`TEAM.md`（团队索引）、`members/<name>.md`（成员索引）、`members/<name>/`（成员 topic 文件）、`shared/`（团队共享记忆）
- 新增四类记忆类型：user（私有）、feedback（私有）、project（团队共享）、reference（团队共享）
- 新增分层上下文注入：Identity → Memory Index → TEAM.md → Tasks → Topic files → Nearby AGENTS.md
- 新增框架自动记忆管理：compaction 触发后台写入 member .md + topic 文件，索引超 200 行触发自动压缩
- 新增工具集：`team-edit`、`team-read`、`member-edit`、`member-read`、`self-edit`、`memory-write`
- 修改 `appendSystemPromptFor()` 支持分层注入
- 修改 `AgentServer` 事件处理：member 完成时注入记忆索引而非原始 summary
- 修改 TUI WorkersView 适配新的 member 概念

## Capabilities

### New Capabilities
- `team-memory`: Markdown 驱动的团队记忆系统——文档即状态、四类记忆、索引+topic 文件、自动压缩
- `team-context-injection`: 分层上下文注入——6 层注入管道（Identity → Memory Index → TEAM.md → Tasks → Topic files → Nearby）
- `team-auto-memory`: 框架自动记忆管理——compaction 触发写入、索引超限压缩、compaction 后重新注入

### Modified Capabilities
- `team-orchestration`: team 工具从 spawn/poll/cancel 三动作改为 team-edit/team-read/member-edit/member-read/self-edit/memory-write 六工具；member 概念替代 worker 概念
- `worker-pool`: WorkerSessionPool 替换为 TeamManager，接口从 WorkerSessionPoolLike 改为 TeamManagerLike；member 生命周期与 Agent Session 对齐
- `team-v2-http-api`: HTTP API 适配新的 TeamManager 接口，member CRUD 改为文档读写

## Non-goals

- **不实现跨进程团队协作**——本提案仅限单进程内的团队管理，不涉及多进程/多机器的团队协调
- **不实现 member 间直接通信**——member 间通过 TEAM.md 和 shared/ 目录间接协作，不实现 mailbox/inbox
- **不实现 worktree 隔离**——member 与 leader 共享同一工作目录，不创建 git worktree
- **不实现记忆版本控制**——topic 文件不做 git 版本管理，仅靠文件系统时间戳
- **不实现记忆搜索**——不提供语义搜索，仅支持关键词匹配和文件名索引
- **不迁移旧数据**——不提供从 TeamStorage JSON 到 Markdown 的数据迁移工具
