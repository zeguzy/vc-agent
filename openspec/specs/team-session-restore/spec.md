# team-session-restore Specification

## Purpose
TBD - created by archiving change team-session-restore. Update Purpose after archive.
## Requirements
### Requirement: TeamManager 从磁盘恢复成员列表

系统 SHALL 在 `TeamManager` 提供 `restoreMembers()` 方法，从磁盘 TEAM.md 读取成员列表 + session 引用，恢复成员到运行时 `members` Map，使 session 切换后成员列表在 UI 上正确显示。成员与 leader 使用相同的上下文管理方式。

#### Scenario: session 切换后自动恢复成员
- **WHEN** `server/index.ts` 的 `setRebindSession` 回调创建新 `TeamManager` 后
- **THEN** SHALL 调用 `teamManager.restoreMembers()` 从磁盘恢复成员
- **AND** 恢复后 `listMembers()` SHALL 返回与 TEAM.md 一致的成员列表
- **AND** UI 通过 `subscribeTeam` 收到 `members_restored` 事件后 SHALL 显示成员列表

#### Scenario: 磁盘无 TEAM.md 时不报错
- **WHEN** `restoreMembers()` 被调用但 teamDir 下无 TEAM.md 或 TEAM.md 无成员行
- **THEN** SHALL 不抛异常，`members` Map 保持为空

#### Scenario: 单个成员恢复失败不阻塞其他
- **WHEN** `restoreMembers()` 中某个成员的 session 文件损坏或 `SessionManager.open` 抛异常
- **THEN** SHALL try-catch 该成员，log 警告，跳过该成员继续恢复其他成员

### Requirement: 成员与 leader 同构 — 使用持久化 SessionManager

系统 SHALL 在 `createMember` 中使用 `SessionManager.create(cwd, sessionDir)` 创建持久化 session（与 leader 相同的 API），使成员对话历史写入 JSONL 文件。成员 session 文件 SHALL 存放在标准 sessions 目录（`~/.config/openagent/sessions/`）下。TEAM.md 的 members 表 SHALL 包含 `Session` 列记录成员的 sessionFile 路径。

#### Scenario: 创建成员时持久化 session
- **WHEN** `createMember` 被调用创建新成员
- **THEN** SHALL 使用 `SessionManager.create(cwd, sessionDir)` 创建持久化 SessionManager
- **AND** 成员 session 文件 SHALL 位于标准 sessions 目录
- **AND** 对话消息 SHALL 通过 SDK 自动 append-only 写入 JSONL 文件
- **AND** `MemberState.sessionFile` SHALL 记录成员的 session 文件路径
- **AND** TEAM.md members 表的 Session 列 SHALL 记录该路径

#### Scenario: 恢复成员时用 SessionManager.open 继续已有 session
- **WHEN** `restoreMembers()` 恢复已有成员且该成员 TEAM.md 中有 sessionFile 记录
- **THEN** SHALL 使用 `SessionManager.open(sessionFile, sessionDir)` 恢复对话上下文（与 leader 的 `buildSessionManager(mode="session")` 完全对称）
- **AND** 成员 SHALL 能访问恢复前的对话历史

#### Scenario: 恢复成员时无 session 引用则新建
- **WHEN** `restoreMembers()` 恢复已有成员但 TEAM.md 中无 Session 列或值为空
- **THEN** SHALL fallback 到 `SessionManager.create(cwd, sessionDir)` 创建新 session
- **AND** 成员 SHALL 从头开始（仅有 L1+L2+L3 system prompt 上下文）

### Requirement: 恢复的成员状态重置为 idle

系统 SHALL 在 `restoreMembers()` 中将所有恢复成员的 `status` 重置为 `idle`，无论磁盘 TEAM.md 记录的 status 是什么。因为 session 切换意味着任务已中断。

#### Scenario: 恢复后成员状态为 idle
- **WHEN** `restoreMembers()` 恢复成员
- **THEN** 每个恢复成员的 `status` SHALL 为 `idle`
- **AND** `currentTaskId` SHALL 为 `null`
- **AND** TEAM.md 中对应成员的 `status` SHALL 更新为 `idle`

### Requirement: dispose 保留成员 session 文件

系统 SHALL 在 `TeamManager.dispose()` 中保留成员 session 文件，仅释放内存中的 AgentSession 和清空 Map。因为 session 文件存在标准 sessions 目录下，不由 team 生命周期管理。

#### Scenario: dispose 后 session 文件仍存在
- **WHEN** `dispose()` 被调用
- **THEN** 成员 session 文件（标准 sessions 目录下的 JSONL 文件）SHALL 保留在磁盘
- **AND** 成员记忆文件（`members/<name>/`）SHALL 保留在磁盘
- **AND** `members` Map SHALL 被清空

