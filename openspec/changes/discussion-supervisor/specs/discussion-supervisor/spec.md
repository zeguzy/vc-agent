# discussion-supervisor Specification

## Purpose

定义讨论监督者（Discussion Supervisor）的行为规范——议题跟踪、偏移检测、redirect 强制拉回、跨轮状态保持、多成员讨论管理。

## Requirements

### Requirement: DiscussionPlan 与 AgendaItem 类型定义

系统 SHALL 在 `src/teams/coordinator.ts` 中定义以下类型：

```typescript
interface AgendaItem {
  id: string;
  title: string;
  description: string;
  status: "pending" | "in_progress" | "covered" | "skipped";
}

interface DiscussionPlan {
  topic: string;
  agenda: AgendaItem[];
  scope: string;
  offTopicSignals: string;
}
```

`DiscussionPlan` SHALL 可选地由 Leader 在创建讨论任务时提供。未提供时，Supervisor SHALL 在第一轮自动从 `task.title` 和 `task.description` 生成默认 plan。

#### Scenario: Leader 提供 DiscussionPlan

- **WHEN** Leader 调用 `team(action="assign", type="discussion", ..., plan: { topic: "...", agenda: [...], scope: "...", offTopicSignals: "..." })`
- **THEN** 系统 SHALL 将 plan 传递给 DiscussionSupervisor
- **AND** Supervisor SHALL 使用 Leader 提供的 plan 作为讨论框架

#### Scenario: Leader 未提供 DiscussionPlan

- **WHEN** Leader 调用 `team(action="assign", type="discussion")` 未提供 plan
- **THEN** Supervisor SHALL 在第一轮评估时自动生成 DiscussionPlan
- **AND** 生成的 plan SHALL 从 `task.title` 和 `task.description` 推导 agenda items
- **AND** scope SHALL 默认为 task.description 内容
- **AND** offTopicSignals SHALL 默认为 "discussing implementation details when only architecture decisions are needed, or going deep on one topic while others remain uncovered"

### Requirement: DiscussionSupervisor 类持有跨轮状态

系统 SHALL 在 `src/teams/coordinator.ts` 中实现 `DiscussionSupervisor` 类，替代当前的 `runCoordinator` 函数。该类 SHALL：
- 持有自己的 `AgentSession`（跨轮复用，不每轮创建新 session）
- 持有 `DiscussionPlan`（每轮更新 agenda item 状态）
- 持有 `round` 计数器
- 通过 `session.steer()` 注入每轮新信息
- 在 `dispose()` 时清理 session

`DiscussionSupervisor` SHALL 通过 `TeamManager` 的生命周期管理（创建于第一个 discussion 任务分配时，随 TeamManager.dispose() 一起清理）。

#### Scenario: Supervisor 跨轮保持状态

- **WHEN** 第一轮讨论中 member A 发言完毕，Supervisor 评估后决定 continue
- **THEN** Supervisor SHALL 更新 agenda item 状态（如将 A 讨论的议题标记为 "in_progress" 或 "covered"）
- **AND** Supervisor SHALL 通过 steer 将评估结果注入自己的 session
- **AND** 第二轮评估时 Supervisor SHALL 看到第一轮的完整上下文（包括 agenda 状态更新）

#### Scenario: Supervisor session 复用

- **WHEN** 多轮讨论连续进行
- **THEN** Supervisor SHALL 始终使用同一个 AgentSession
- **AND** SHALL NOT 每轮创建新 session
- **AND** SHALL NOT 丢失前几轮的评估历史

### Requirement: Supervisor prompt 包含偏移检测和议题跟踪

`DiscussionSupervisor` 的 system prompt SHALL 包含以下增强内容：

1. **Agenda 跟踪**：列出当前 agenda items 及其状态（pending/in_progress/covered/skipped）
2. **偏移检测指令**：明确要求检查"最近消息是否偏离了讨论目标的 scope"
3. **Scope 边界**：从 DiscussionPlan.scope 读取讨论范围边界
4. **Off-topic 信号**：从 DiscussionPlan.offTopicSignals 读取偏题信号

#### Scenario: Supervisor 检测到偏移并发出 redirect

- **WHEN** Supervisor 评估最近消息发现讨论偏离了 scope
- **THEN** Supervisor SHALL 输出 `{ action: "redirect", nextSpeaker: "...", instruction: "...", reason: "..." }`
- **AND** instruction SHALL 明确指向需要回归的 agenda item
- **AND** reason SHALL 说明为什么判定为偏移

#### Scenario: Supervisor 未检测到偏移

- **WHEN** Supervisor 评估最近消息发现讨论在 scope 内
- **THEN** Supervisor SHALL 输出 `{ action: "continue", ... }` 或 `{ action: "summarize", ... }`
- **AND** SHALL NOT 发出 redirect

### Requirement: Supervisor 支持四种 action

SupervisorDecision 类型 SHALL 扩展为四种 action：

1. **continue**：讨论需要继续，指定下一个发言人和指令
2. **redirect**：讨论偏移，强制拉回到指定 agenda item
3. **summarize**：要求某人总结当前议题的讨论成果
4. **complete**：讨论完成

```typescript
interface SupervisorContinue {
  action: "continue";
  nextSpeaker: MemberName;
  instruction: string;
  reason: string;
  agendaUpdates?: Partial<AgendaItem>[];
}

interface SupervisorRedirect {
  action: "redirect";
  nextSpeaker: MemberName;
  instruction: string;
  reason: string;
  targetAgendaId: string;
  agendaUpdates?: Partial<AgendaItem>[];
}

interface SupervisorSummarize {
  action: "summarize";
  nextSpeaker: MemberName;
  instruction: string;
  reason: string;
  targetAgendaId: string;
  agendaUpdates?: Partial<AgendaItem>[];
}

interface SupervisorComplete {
  action: "complete";
  reason: string;
  agendaUpdates?: Partial<AgendaItem>[];
}

type SupervisorDecision = SupervisorContinue | SupervisorRedirect | SupervisorSummarize | SupervisorComplete;
```

#### Scenario: redirect action 输出结构

- **WHEN** Supervisor 决定 redirect
- **THEN** 输出 JSON SHALL 包含 `action: "redirect"`, `nextSpeaker`, `instruction`, `reason`, `targetAgendaId` 字段
- **AND** `targetAgendaId` SHALL 指向需要回归的 agenda item

#### Scenario: summarize action 输出结构

- **WHEN** Supervisor 决定 summarize
- **THEN** 输出 JSON SHALL 包含 `action: "summarize"`, `nextSpeaker`, `instruction`, `reason`, `targetAgendaId` 字段
- **AND** instruction SHALL 要求总结该 agenda item 的讨论成果

#### Scenario: continue action 与当前行为兼容

- **WHEN** Supervisor 决定 continue
- **THEN** 输出 JSON SHALL 包含 `action: "continue"`, `nextSpeaker`, `instruction`, `reason` 字段
- **AND** 行为 SHALL 与当前 CoordinatorContinue 一致

#### Scenario: complete action 与当前行为兼容

- **WHEN** Supervisor 决定 complete
- **THEN** 输出 JSON SHALL 包含 `action: "complete"`, `reason` 字段
- **AND** 行为 SHALL 与当前 CoordinatorComplete 一致

### Requirement: redirect action 使用 directMember 强制注入

当 Supervisor 决策为 `redirect` 时，系统 SHALL 调用 `TeamManager.directMember(nextSpeaker, "redirect", instruction)` 而非 `session.steer(instruction)`。

对于 `continue` 和 `summarize` action，系统 SHALL 继续使用 `session.steer()` 注入指令。

#### Scenario: redirect 通过 directMember 注入

- **WHEN** Supervisor 返回 `{ action: "redirect", nextSpeaker: "alice", instruction: "回到架构决策", ... }`
- **THEN** 系统 SHALL 调用 `this.directMember("alice", "redirect", "回到架构决策")`
- **AND** SHALL NOT 调用 `session.steer()`

#### Scenario: continue 通过 steer 注入

- **WHEN** Supervisor 返回 `{ action: "continue", nextSpeaker: "bob", instruction: "分享你的观点", ... }`
- **THEN** 系统 SHALL 调用 `targetState.session.steer("[⚡ COORDINATOR] 分享你的观点")`
- **AND** SHALL NOT 调用 `directMember`

### Requirement: 多成员讨论任务支持

系统 SHALL 支持创建不绑定单个 member 的讨论任务。`TaskState` SHALL 新增 `participants: MemberName[]` 字段。讨论任务的 `memberName` SHALL 为 null，`participants` SHALL 为参与者列表。执行任务的 `participants` SHALL 为 `[memberName]`。

#### Scenario: 创建讨论任务时指定多个参与者

- **WHEN** Leader 调用 `team(action="assign", type="discussion", name="alice", title="架构评审", ..., participants: ["alice", "bob", "carol"])`
- **THEN** 系统 SHALL 创建 TaskState，`memberName` 为 null，`participants` 为 `["alice", "bob", "carol"]`
- **AND** 所有参与者 SHALL 收到讨论任务通知

#### Scenario: 执行任务的 participants 兼容

- **WHEN** Leader 调用 `team(action="assign", type="execution", name="alice", title="实现功能")`
- **THEN** TaskState SHALL 设置 `memberName` 为 `"alice"`，`participants` 为 `["alice"]`
- **AND** 行为 SHALL 与当前完全一致

### Requirement: startDiscussion 方法

`TeamManager` SHALL 新增 `startDiscussion(opts)` 方法：

```typescript
startDiscussion(opts: {
  title: string;
  description: string;
  participants: MemberName[];
  priority?: "high" | "medium" | "low";
  plan?: DiscussionPlan;
}): TaskState
```

该方法 SHALL：
1. 创建 TaskState（`type: "discussion"`, `memberName: null`, `participants: opts.participants`）
2. 创建 DiscussionSupervisor 实例
3. 向第一个参与者发送讨论开始指令
4. 返回 TaskState

#### Scenario: startDiscussion 创建讨论任务

- **WHEN** 调用 `teamManager.startDiscussion({ title: "架构评审", description: "...", participants: ["alice", "bob"] })`
- **THEN** SHALL 创建 TaskState，id 为 "T{n}", type 为 "discussion"
- **AND** memberName SHALL 为 null
- **AND** participants SHALL 为 ["alice", "bob"]
- **AND** SHALL 创建 DiscussionSupervisor 实例
- **AND** 第一个参与者 SHALL 收到讨论开始指令

#### Scenario: startDiscussion 带自定义 plan

- **WHEN** 调用 `teamManager.startDiscussion({ ..., plan: { topic: "...", agenda: [...], scope: "...", offTopicSignals: "..." } })`
- **THEN** Supervisor SHALL 使用提供的 plan 而非自动生成

#### Scenario: 参与者不存在时抛错

- **WHEN** 调用 `startDiscussion` 时 participants 中包含不存在的 member name
- **THEN** SHALL 抛出错误，不创建讨论任务

### Requirement: Member Anti-Patterns 增加 supervisor 遵循约束

当 member 参与讨论任务时，其 Anti-Patterns section SHALL 追加一条约束："When participating in a discussion, you MUST follow the supervisor's redirect instructions immediately. If the supervisor says to return to a topic, stop the current line of discussion and refocus."

#### Scenario: 讨论参与者遵循 redirect

- **WHEN** member 收到 supervisor 的 redirect 指令
- **THEN** member SHALL 立即停止当前讨论方向
- **AND** SHALL 转向 redirect 指令指定的议题
