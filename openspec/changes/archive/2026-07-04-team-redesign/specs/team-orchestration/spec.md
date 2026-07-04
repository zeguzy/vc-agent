## MODIFIED Requirements

### Requirement: team 工具暴露成员管理和任务协作动作

系统 SHALL 在 `src/tools/team.ts` 定义单一 ToolDefinition 暴露给主 agent，参数 schema 中 `action` 字段决定执行分支：

- `create-member`：创建拟人化团队成员，返回 memberId
- `assign-task`：创建并分配任务给成员
- `claim-task`：成员认领 open 任务
- `list-members`：列出所有成员及状态
- `list-tasks`：列出任务池状态
- `task-status`：查看单个任务进度
- `send-message`：成员间发送消息
- `poll`：查询成员当前状态和输出（保留，语义从 worker 变为 member）
- `cancel`：停止成员（保留）

移除 `spawn` 和 `continue` action。Leader 通过 `create-member` + `assign-task` 替代 spawn 语义；通过 `send-message` 替代 continue 语义。

#### Scenario: create-member 创建成员
- **WHEN** leader 调用 `team` 工具，参数 `{action: "create-member", name: "Alice", role: "前端开发", goal: "实现登录页", model: "deepseek-v4-pro"}`
- **THEN** SHALL 注册成员到 TeamSession，返回 `{memberId, name, status: "idle"}`
- **AND** 成员尚未启动 session，处于待命状态

#### Scenario: assign-task 分配任务并启动成员
- **WHEN** leader 调用 `team` 工具，参数 `{action: "assign-task", title: "修复空指针", description: "修复 src/auth/login.ts:42", memberId: "mem_xxx", priority: "high"}`
- **THEN** SHALL 创建任务并关联成员
- **AND** SHALL 启动成员的独立 Pi SDK session
- **AND** SHALL 返回 `{taskId, memberId, status: "assigned"}`

#### Scenario: poll 查询成员状态
- **WHEN** leader 调用 `team` 工具，参数 `{action: "poll", memberId: "mem_xxx"}`
- **THEN** SHALL 返回成员当前状态：status、turnCount、lastSummary（默认 2048 字符截断，full=true 完整返回）

#### Scenario: cancel 停止成员
- **WHEN** leader 调用 `team` 工具，参数 `{action: "cancel", memberId: "mem_xxx"}`
- **THEN** SHALL 中止成员的 session，释放资源
- **AND** 成员状态变为 cancelled，已分配任务回到 open 状态

### Requirement: Team orchestrator system prompt 重写

系统 SHALL 重写 `TEAM_ORCHESTRATOR_PROMPT`，指导 leader 如何：
1. 分析任务，决定创建哪些成员（名字、角色、目标、模型）
2. 组织需求评审：创建成员后先讨论需求，让成员提问
3. 分解任务到 TaskPool：为每个成员分配具体任务
4. 成员自主执行、遇到问题通过 send-message 求助
5. Leader 通过 poll 跟踪进度，在关键节点汇总结论

#### Scenario: prompt 指导 leader 创建团队
- **WHEN** system prompt 注入到 team/orchestrator 模式的 leader session
- **THEN** SHALL 包含：如何根据任务特性决定团队成员构成、如何分配角色、如何组织评审、如何跟踪进度
- **AND** SHALL NOT 包含 `team.spawn` 或 `team.continue` 的使用说明

#### Scenario: prompt 包含协作模式指南
- **WHEN** leader 收到团队协作任务
- **THEN** prompt SHALL 指导 leader 按任务特性选择协作方式：
  - 探索型任务 → 创建多个探索者并行搜索
  - 实现型任务 → 创建 builder + reviewer 分工
  - 讨论型任务 → 先让成员讨论评审，再分配执行

## REMOVED Requirements

### Requirement: team 工具暴露 spawn / poll / cancel 三个动作

**Reason**: spawn/continue 语义与 subagent 工具重叠，缺乏团队协作感。替换为 create-member/assign-task/send-message 体系。

**Migration**: 旧 `team(action="spawn", agent="flagella", task="...")` → 新 `team(action="create-member", name="Seeker", role="探索者")` + `team(action="assign-task", memberId="mem_xxx", description="...")`。`team.poll` 和 `team.cancel` 保留，语义从 worker 变为 member。
