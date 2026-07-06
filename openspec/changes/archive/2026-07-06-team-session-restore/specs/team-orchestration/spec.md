## MODIFIED Requirements

### Requirement: team 工具暴露 spawn / poll / cancel 三个动作

系统 SHALL 在 `src/tools/team.ts` 定义单一 ToolDefinition 暴露给 leader agent，参数 schema 中 `action` 字段决定执行分支：`"read"`（读取 TEAM.md 状态）、`"create"`（创建成员）、`"assign"`（分配任务）、`"direct"`（向活跃成员发送指令）、`"edit-member"`（编辑成员属性）、`"complete"`（完成任务）、`"remove"`（移除成员）。成员与 leader 同构——使用相同的持久化 `SessionManager` API，成员 session 文件存放在标准 sessions 目录（`~/.config/openagent/sessions/`）下。TEAM.md members 表 SHALL 通过 `Session` 列持有成员的 sessionFile 引用。`team` 工具与现有同步 `subagent` 工具并存，互不影响。

#### Scenario: create 动作创建持久化成员（与 leader 同构）
- **WHEN** leader agent 调用 `team` 工具，参数 `{action: "create", name: "alice", role: "实现者", goal: "..."}`
- **THEN** SHALL 调用 `TeamManager.createMember`
- **AND** `createMember` SHALL 使用 `SessionManager.create(cwd, sessionDir)` 创建持久化 session（与 leader 相同的 API）
- **AND** sessionDir SHALL 为标准 `resolveSessionDir()`（与 leader 相同）
- **AND** 成员 session 文件 SHALL 位于标准 sessions 目录
- **AND** TEAM.md members 表 SHALL 在 Session 列记录成员的 sessionFile 路径

#### Scenario: read 动作返回当前团队状态
- **WHEN** leader agent 调用 `team` 工具，参数 `{action: "read"}`
- **THEN** SHALL 返回 TEAM.md 当前内容（成员列表含 Session 列、任务列表、共享记忆索引）

#### Scenario: assign 动作分配任务给成员
- **WHEN** leader agent 调用 `team` 工具，参数 `{action: "assign", memberName: "alice", title: "实现 auth", description: "..."}`
- **THEN** SHALL 调用 `TeamManager.assignTask`
- **AND** 成员 SHALL 通过 `session.prompt` 或 `session.steer` 收到任务指令

#### Scenario: remove 动作移除并归档成员
- **WHEN** leader agent 调用 `team` 工具，参数 `{action: "remove", memberName: "alice"}`
- **THEN** SHALL 调用 `TeamManager.removeMember`
- **AND** 成员目录 SHALL 被归档到 `_archived/`
- **AND** 成员 session 文件 SHALL 保留在标准 sessions 目录（不删除）

#### Scenario: direct 动作向活跃成员发送指令
- **WHEN** leader agent 调用 `team` 工具，参数 `{action: "direct", memberName: "alice", kind: "directive", payload: "..."}`
- **THEN** SHALL 调用 `TeamManager.directMember`
- **AND** 成员在 streaming 时通过 `steer`，否则通过 `prompt` 接收指令

#### Scenario: edit-member 动作更新成员属性
- **WHEN** leader agent 调用 `team` 工具，参数 `{action: "edit-member", memberName: "alice", goal: "新目标", activeContext: "新上下文"}`
- **THEN** SHALL 更新成员的 goal 或 activeContext 并写入磁盘

#### Scenario: complete 动作标记任务完成
- **WHEN** leader agent 调用 `team` 工具，参数 `{action: "complete", taskId: "T1"}`
- **THEN** SHALL 调用 `TeamManager.completeTask`
- **AND** 成员状态 SHALL 更新为 idle
