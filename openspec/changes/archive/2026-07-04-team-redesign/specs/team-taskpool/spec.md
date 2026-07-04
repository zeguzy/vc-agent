## ADDED Requirements

### Requirement: Leader 可创建和分配任务

系统 SHALL 在 team tool 中提供 `create-task` 和 `assign-task` action，允许 leader 定义任务并分配给特定成员。任务 SHALL 拥有独立 ID、标题、描述、优先级、状态、分配对象。

#### Scenario: Leader 创建并分配任务
- **WHEN** leader 调用 `team(action="create-task", title="修复登录 bug", description="修复 src/auth/login.ts:42 的空指针", priority="high")`
- **THEN** SHALL 生成 task id（`task_<8 char base32>`），状态为 `open`
- **AND** SHALL 返回 `{taskId, title, status: "open"}`

#### Scenario: Leader 分配任务给成员
- **WHEN** leader 调用 `team(action="assign-task", taskId="task_xxx", memberId="mem_xxx")`
- **THEN** 任务状态 SHALL 变为 `assigned`
- **AND** 若成员当前 idle，SHALL 自动启动成员（发送 task description 到成员的独立 session）
- **AND** 若成员当前 working，任务 SHALL 进入该成员的待办队列

#### Scenario: 成员认领 open 任务
- **WHEN** leader 调用 `team(action="claim-task", taskId="task_xxx")` 省略 memberId
- **THEN** SHALL 从 TeamSession.leaderContext 推断当前活跃成员并分配
- **AND** 若无法推断成员，SHALL 返回错误 `"请指定 memberId 或确保有唯一活跃成员"`

#### Scenario: 任务优先级排序
- **WHEN** leader 调用 `team(action="list-tasks")`
- **THEN** SHALL 按 priority 降序（high → medium → low）返回所有任务
- **AND** 每个任务显示 id、title、status、assignedTo、priority

### Requirement: 任务状态跟踪

系统 SHALL 支持任务状态流转：`open → assigned → in_progress → done | blocked`。Leader SHALL 可通过 `task-status` 查看单个任务或全部任务的进度。

#### Scenario: 查看单个任务状态
- **WHEN** leader 调用 `team(action="task-status", taskId="task_xxx")`
- **THEN** SHALL 返回该任务的详细状态：当前状态、分配成员、成员最新输出摘要、耗时

#### Scenario: 任务被阻塞
- **WHEN** leader 调用 `team(action="block-task", taskId="task_xxx", reason="等待 API 密钥配置")`
- **THEN** 任务状态 SHALL 变为 `blocked`
- **AND** reason SHALL 被保存，leader 可通过 `list-tasks` 看到阻塞原因

#### Scenario: 任务完成后自动触发成员状态更新
- **WHEN** 成员执行完分配的任务，成员的 session 收到 `agent_end`
- **THEN** 对应任务的状态 SHALL 自动变为 `done`
- **AND** 成员的 context SHALL 更新包含完成摘要
- **AND** 若成员有待办队列中的下一任务，SHALL 自动启动
