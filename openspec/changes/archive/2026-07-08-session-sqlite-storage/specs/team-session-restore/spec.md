## MODIFIED Requirements

### Requirement: 成员与 leader 同构 — 使用 patched SessionManager 持久化

系统 SHALL 在 `createMember` 中使用 patched `SessionManager.create(cwd)` 创建持久化 session（与 leader 相同的 API，调用点不变，因为 `installSqliteBackend()` 已 patch 类）。使成员对话 entry 写入 SQLite DB。成员 session 记录 SHALL 存储在同一 DB 的 session + entry 表中（与 leader 并列，用 `session.cwd` 列区分项目）。TEAM.md 的 members 表 SHALL 包含 `Session` 列记录成员的 `sqlite://<sessionId>` 合成标识。`MemberState.sessionFile` SHALL 持有该 `sqlite://<sessionId>` 标识。

#### Scenario: 创建成员时持久化 session

- **WHEN** `createMember` 被调用创建新成员
- **THEN** SHALL 使用 patched `SessionManager.create(cwd)` 创建持久化 session（调用点不变，SDK 静态方法已被 `installSqliteBackend()` patch）
- **AND** 成员 entry SHALL 通过 patched `_persist` 写入同一 DB 的 entry 表
- **AND** `MemberState.sessionFile` SHALL 记录 `sqlite://<sessionId>` 合成标识
- **AND** TEAM.md members 表的 Session 列 SHALL 记录该 `sqlite://<sessionId>` 标识

#### Scenario: 恢复成员时用 patched SessionManager.open 继续已有 session

- **WHEN** `restoreMembers()` 恢复已有成员且该成员 TEAM.md 中 Session 列记录了 `sqlite://<sessionId>`
- **THEN** SHALL 从 Session 列解析出 sessionId（`parseSessionIdFromUri` 解析 `sqlite://` 前缀）
- **AND** 调用 patched `SessionManager.open` 恢复对话上下文（与 leader 的 `buildSessionManager(mode="session")` 完全对称）
- **AND** patched `setSessionFile` SHALL 从 DB 按 sort_order 加载 entries，调 SDK `_buildIndex()` 重建全部 4 个内存索引（byId/leafId/labelsById/labelTimestampsById）
- **AND** 成员 SHALL 能访问恢复前的对话历史

#### Scenario: 恢复成员时无 session 引用则新建

- **WHEN** `restoreMembers()` 恢复已有成员但 TEAM.md 中无 Session 列或值为空
- **THEN** SHALL fallback 到 patched `SessionManager.create(cwd)` 创建新 session
- **AND** 成员 SHALL 从头开始（仅有 L1+L2+L3 system prompt 上下文）

#### Scenario: 从 sessionFile 提取 sessionId

- **WHEN** `createMember` 或 `restoreMembers` 创建/恢复成员 session 后需提取 sessionId 存入 MemberState
- **THEN** SHALL 从 `session.sessionFile`（值为 `sqlite://<sessionId>` 格式）用 `parseSessionIdFromUri` 解析前缀提取 sessionId
- **AND** SHALL NOT 使用 `basename().replace(/\.jsonl$/,"")` 等 .jsonl 路径解析逻辑（该逻辑已废弃）

#### Scenario: 废弃 .jsonl 路径校验函数

- **WHEN** `restoreMembers()` 恢复成员 session 时校验 session 引用有效性
- **THEN** SHALL 用 `validateSessionId(sessionId)` 校验 id 格式（已有函数）
- **AND** SHALL NOT 使用 `resolveMemberSessionPath` 或 `validateMemberSessionPath`（这些函数面向 .jsonl 文件路径，已废弃）
