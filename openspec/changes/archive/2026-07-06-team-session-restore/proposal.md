## Why

Team 模式在 `/session` 切换后丢失所有运行时状态：成员列表在 UI 上消失，成员的对话历史也无法恢复。根因是架构上的不一致——**成员和 leader 使用了两套不同的上下文管理机制**。Leader 用 `SessionManager.create/open/continueRecent`（JSONL 持久化），成员用 `SessionManager.inMemory()`（无持久化）。但成员和 leader 本质上是同构的 AgentSession，应该复用同一套上下文管理方式。

具体问题：
1. `TeamManager` 在 session 切换时被 dispose 后重建为空实例，从不读取磁盘上已有的 TEAM.md
2. 成员的 `AgentSession` 使用 `SessionManager.inMemory()`，对话历史无 JSONL 持久化，dispose 后永久丢失

## What Changes

- **成员与 leader 同构**：`createMember` 改用持久化 `SessionManager.create()`（成员 session 文件存入标准 sessions 目录），使对话历史写入 JSONL，与 leader 完全对称
- **TEAM.md 持有 session 引用**：members 表新增 `Session` 列存储成员的 sessionFile 路径，team 配置只持有引用不持有数据
- **restoreMembers() 方法**：从 TEAM.md 读取成员列表 + session 引用 → `SessionManager.open(sessionFile)` 恢复对话上下文（与 leader 的恢复路径完全对齐）
- **setRebindSession 集成**：回调在创建新 TeamManager 后调用 `restoreMembers()`
- **dispose() 保留 session 文件**：session 文件存在标准 sessions 目录，不由 team 管理，dispose 只清理内存引用

## Capabilities

### New Capabilities

- `team-session-restore`: Team 模式 session 切换后从磁盘恢复成员列表和成员对话上下文的能力。成员与 leader 使用相同的上下文管理方式。

### Modified Capabilities

- `team-orchestration`: 成员创建改用持久化 SessionManager，TEAM.md members 表新增 Session 列
- `session-persistence`: 成员 session 文件纳入标准持久化体系（与 leader session 并列在 ~/.config/openagent/sessions/）

## Non-goals

- 不实现 git worktree 隔离（`TeamConfig.isolation` 字段已预留但不在本次范围）
- 不实现跨进程的成员状态恢复（仅限同一 openagent 进程内的 session 切换）
- 不实现成员对话历史的 UI 浏览（仅恢复运行时上下文，不做历史回放 UI）
- 不修改 V1 Worker 的持久化逻辑（V1 是临时同步模型，不需要恢复）

## Impact

- `src/teams/manager-v2.ts` — 新增 `restoreMembers()`，修改 `createMember()` 使用持久化 SessionManager
- `src/teams/files.ts` — 修改 TEAM.md members 表格式（新增 Session 列），修改 parseMembersTable/serializeTeamMd
- `src/teams/types-v2.ts` — `MemberState` 新增 `sessionFile` 字段，`TeamMdStructure.members` 元素新增 `sessionFile`
- `src/server/index.ts` — `setRebindSession` 回调调用 `restoreMembers()`
- 磁盘影响：每个成员新增一个 JSONL session 文件（与 leader session 同等大小量级，存放在标准 sessions 目录下）
