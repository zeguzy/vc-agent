## MODIFIED Requirements

### Requirement: team 工具暴露 spawn / poll / cancel 三个动作

系统 SHALL 在 `src/tools/team.ts` 定义单一 ToolDefinition 暴露给 leader agent，参数 schema 中 `action` 字段决定执行分支：`"read"`（读取 TEAM.md 状态）、`"create"`（创建成员）、`"assign"`（分配任务）、`"direct"`（向活跃成员发送指令）、`"edit-member"`（编辑成员属性）、`"complete"`（完成任务）、`"remove"`（移除成员）。**新增**：`"assign"` 和 `"assign-batch"` action 的参数 schema SHALL 新增可选 `type` 字段（`"execution" | "discussion"`，默认 `"execution"`）。`"create"` 和 `"create-batch"` action 的参数 schema SHALL 新增可选 `taskType` 字段（`"execution" | "discussion"`，默认 `"execution"`），当提供 `taskTitle` 时该 type 透传给 `assignTask`。

成员与 leader 同构——使用相同的持久化 `SessionManager` API，成员 session 文件存放在标准 sessions 目录（`~/.config/openagent/sessions/`）下。TEAM.md members 表 SHALL 通过 `Session` 列持有成员的 sessionFile 引用。`team` 工具与现有同步 `subagent` 工具并存，互不影响。

#### Scenario: assign 动作分配讨论任务

- **WHEN** leader agent 调用 `team` 工具，参数 `{action: "assign", name: "alice", title: "架构评审", description: "...", type: "discussion"}`
- **THEN** SHALL 调用 `TeamManager.assignTask` 并透传 `type: "discussion"`
- **AND** 成员 SHALL 通过 `session.prompt` 或 `session.steer` 收到讨论任务指令

#### Scenario: assign 动作不传 type 时默认为 execution

- **WHEN** leader agent 调用 `team` 工具，参数 `{action: "assign", name: "alice", title: "实现功能"}`
- **THEN** SHALL 调用 `TeamManager.assignTask` 并透传 `type: "execution"`（默认值）
- **AND** 行为 SHALL 与当前完全一致

#### Scenario: create 动作带 taskType 创建讨论任务

- **WHEN** leader agent 调用 `team` 工具，参数 `{action: "create", name: "alice", role: "架构师", goal: "...", taskTitle: "架构评审", taskType: "discussion"}`
- **THEN** SHALL 创建成员后调用 `TeamManager.assignTask` 并透传 `type: "discussion"`

### Requirement: Team orchestrator system prompt 注入

系统 SHALL 在 `src/context-files.ts` 加载链中条件性追加 team orchestrator system prompt 段落，指导主 agent 在收到适合 spawn 的需求时使用 `team` 工具而非同步 `subagent` 工具。该段落 SHALL 仅在 `Config.teams.enabled !== false` 且主 agent 处于 `"standard"` 模式（非 `"planner"`）时启用。

**新增**：该 prompt 段 SHALL 包含 "Waiting for Your Team" 段落，明确指导 Leader 在分配任务后停止行动，等待系统推送的通知：

```
## Waiting for Your Team

After you assign tasks, STOP. Do not call team(action="read") to check status.
You will receive system notifications when members finish or encounter errors.
Only act when:
- A member reports completion (then assign next task or inform user)
- A member reports an error (then investigate and redirect)
- The user asks you something

NEVER poll for status. NEVER call team(action="wait") followed by team(action="read").
The system will push notifications to you automatically.
```

`team` 工具的 `wait` action description SHALL 弱化轮询鼓励，改为："Block for N seconds (default 30, max 300). Use sparingly — prefer waiting for system notifications rather than polling. Only use when you need to pause before a deliberate follow-up action."

该 prompt 段 SHALL 包含工具分配指南（"Building Your Team" 板块），指导 leader 在创建成员时主动思考角色所需的工具和 skill：
- 工具能力说明：默认成员是只读的（read, bash, grep, find, memory, message），需显式指定 tools 参数才能编辑代码
- 角色工具映射指引：实现类成员 MUST 分配 edit + write；只读研究类成员可保持默认工具集
- Skill 分配指引：leader SHALL 查看注入的 skill 清单，为成员分配相关 skill

`team` 工具的 description 字段 SHALL 在开头醒目提示默认成员是只读的，需显式指定 tools 参数才能编辑代码。

#### Scenario: team orchestrator prompt 包含等待指令

- **WHEN** team orchestrator prompt 被加载
- **THEN** prompt SHALL 包含 "Waiting for Your Team" 或等价板块
- **AND** SHALL 明确禁止轮询（"NEVER poll for status"）
- **AND** SHALL 说明系统会自动推送通知

#### Scenario: wait action 描述弱化轮询鼓励

- **WHEN** LLM 读取 team 工具定义中 wait action 的描述
- **THEN** 描述 SHALL 包含 "prefer waiting for system notifications"
- **AND** SHALL NOT 鼓励 "check team status after wait" 的用法

### Requirement: team 工具 wait 动作真正阻塞 agent loop

（保持不变，仅修改 description 描述文本，实现逻辑不变）

### Requirement: createMember 接口接受可选 constraints 参数

（保持不变）

## ADDED Requirements

### Requirement: member_done 通知改为结构化系统标记

`ensureSubscribed`（`src/server/index.ts`）中 `member_done` 事件注入 Leader session 时，SHALL 用结构化系统标记包裹通知文本：

```
[SYSTEM NOTIFICATION — DO NOT ACT unless there's a problem]
[Team Member {name}{taskTitle} {status}{cost}]
{summary}
[END NOTIFICATION — continue waiting for user or next event]
```

当 Leader session 非 streaming 时（`!this.session.isStreaming`），SHALL NOT 调用 `this.session.prompt(note)` 主动唤醒 Leader。通知信息 SHALL 仅记录到 TeamManager 的内部状态，下次 Leader 被用户唤醒时可通过 `team(action="read")` 获取。

`member_error` 事件 SHALL 始终主动注入（错误需要 Leader 立即处理）。

#### Scenario: member_done 通知格式

- **WHEN** member "alice" 完成任务，Leader session 正在 streaming
- **THEN** 系统 SHALL 通过 `steer` 注入包裹在 `[SYSTEM NOTIFICATION — DO NOT ACT unless there's a problem]` 和 `[END NOTIFICATION]` 之间的文本
- **AND** 文本 SHALL 包含 member name、task title、status、cost、summary

#### Scenario: Leader 非 streaming 时不主动唤醒

- **WHEN** member "alice" 完成任务，Leader session 非 streaming
- **THEN** 系统 SHALL NOT 调用 `this.session.prompt(note)`
- **AND** SHALL 仅更新 TeamManager 内部状态
- **AND** 下次 Leader 被用户唤醒时可通过 `team(action="read")` 看到 alice 已完成

#### Scenario: member_error 始终主动注入

- **WHEN** member "alice" 报错，无论 Leader session 是否 streaming
- **THEN** 系统 SHALL 主动注入错误通知
- **AND** Leader SHALL 收到错误信息并决定如何处理

### Requirement: TeamManagerLike.assignTask 接口增加 type 参数

`TeamManagerLike.assignTask`（`src/teams/types-v2.ts`）的 opts 参数 SHALL 新增可选字段 `type?: TaskType`。默认值为 `"execution"`。`TeamManager.assignTask` 实现 SHALL 将 type 透传到创建的 TaskState 中。

客户端接口（`AgentClient.assignTask`、`InProcessClient`、`HttpClient`）SHALL 同步接受并透传 `type` 字段。

#### Scenario: assignTask 透传 type

- **WHEN** 调用 `manager.assignTask({ title, description, memberName, type: "discussion" })`
- **THEN** 创建的 TaskState SHALL 有 `type: "discussion"`

#### Scenario: assignTask 不传 type 时默认 execution

- **WHEN** 调用 `manager.assignTask({ title, description, memberName })`
- **THEN** 创建的 TaskState SHALL 有 `type: "execution"`

#### Scenario: HTTP 客户端透传 type

- **WHEN** `HttpClient.assignTask({ ..., type: "discussion" })` 发送 POST
- **THEN** 请求 body SHALL 包含 `type: "discussion"`
