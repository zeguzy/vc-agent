## Context

当前 team 模式 (`WorkerSessionPool` + `team` tool) 在架构上与 subagent 模式完全同构：两者都是创建 Pi SDK `AgentSession` → 执行 `session.prompt(task)` → 返回文本摘要。差异仅在于 team 后台异步执行、通过 poll 获取结果。成员没有身份、目标、任务池，也不能相互通信。用户期望的是"LLM 原生团队"——leader 动态创建拟人化成员、分配任务、成员间可通信协作。

## Goals / Non-Goals

**Goals:**
- 成员有独立身份（name, role, goal, status），由 leader 动态创建，不限预设角色
- 任务池支持 leader 分配任务、成员认领、进度跟踪
- 成员间通过 team channel 相互通信，消息对 leader 可见
- 与 subagent 模式明确区分：subagent = 同步一次委托；team = 持续协作团队
- 协作方式由 leader 按需决定（自由讨论 / 任务分工 / 讨论后分工）

**Non-Goals:**
- 成员持久化（重启后团队解散）
- 任务依赖图（DAG）— V2
- 成员代码合并/冲突解决
- 自动扩缩容
- 修改 subagent 行为

## Decisions

### 1. 新领域模型：TeamMember 替换 Worker

**理由**: 当前 `Worker` 本质是"后台 Subagent"，`WorkerSnapshot` 只有 status/turns/tokens/lastSummary，没有身份/目标/角色。新模型 `TeamMember` 赋予拟人化身份。

```
TeamMember
  id: string           // "mem_<8 char base32>"
  name: string         // leader 指定的名字，如 "Alice"
  role: string         // leader 指定的角色，如 "后端开发"
  goal: string         // leader 指定的目标
  status: "idle" | "working" | "done" | "error"
  model: string        // 分配的模型
  context: string[]    // 对话历史摘要
  createdAt: number
```

### 2. TaskPool：任务分配与跟踪

**理由**: 当前 `team.spawn(task)` 直接指定任务，没有任务队列或分配机制。TaskPool 让 leader 可以预先列出任务，由成员认领或 leader 分配。

```
TeamTask
  id: string           // "task_<8 char base32>"
  title: string        // 任务简述
  description: string  // 详细说明
  assignedTo?: string  // member id
  status: "open" | "assigned" | "in_progress" | "done" | "blocked"
  priority: "high" | "medium" | "low"
  result?: string      // 完成后填充
```

TeamSession 支持 action: `create-task` / `assign-task` / `claim-task` / `task-status` / `list-tasks`

### 3. 成员间通信：TeamMessage 与 Channel

**理由**: 成员需要能相互讨论评审。消息通过 TeamSession 路由，leader 可查看所有消息。

```
TeamMessage
  id: string
  from: string         // member id
  to: string           // member id 或 "team"（广播）
  content: string
  timestamp: number
```

TeamSession 支持 action: `send-message` / `read-inbox`

### 4. 架构重构：WorkerSessionPool → TeamSession

```
TeamSession (new)
  members: Map<id, TeamMember>
  tasks: TaskPool
  messages: TeamMessage[]
  llmContext: shared context blob (非实施细节)

  // 替换 pool 方法
  createMember(opts) → TeamMember
  removeMember(id)
  createTask(task) → TeamTask
  assignTask(taskId, memberId)
  startMember(memberId) // 启动成员的独立 session
  pollMember(id) → MemberStatus
  cancelMember(id)
  sendMessage(from, to, content)
```

### 5. team tool action 重新设计

移除 `spawn` / `continue`，新增成员管理和任务分配语义：

| action | 描述 |
|--------|------|
| `create-member` | 创建成员：指定 name、role、goal、model |
| `assign` | 分配任务给成员 |
| `claim-task` | 成员认领 open 任务 |
| `task-status` | 查看任务池状态 |
| `list-members` | 列出所有成员及状态 |
| `send-message` | 成员间发送消息 |
| `poll` | 保留，查询成员状态 |
| `cancel` | 保留，停止成员 |

### 6. 数据流

```
Leader LLM
  │
  ├─ team(action="create-member", name="Alice", role="frontend", goal="...")
  │    → TeamSession.members.set("mem_xxx", {...})
  │    → 返回 "成员 Alice(mem_xxx) 已创建"
  │
  ├─ team(action="assign", task={...}, member="mem_xxx")
  │    → TeamSession.tasks.set("task_xxx", {assignedTo: "mem_xxx"})
  │    → TeamSession.startMember("mem_xxx")  // 启动独立 Pi SDK session
  │    → 成员 Alice 开始工作
  │
  ├─ team(action="send-message", from="mem_xxx", to="mem_yyy", content="请 review 我的 PR")
  │    → TeamSession 路由消息
  │    → 成员 Bob 收到消息，可回复
  │
  └─ team(action="poll", member="mem_xxx")
       → 返回成员 Alice 的当前状态和输出
```

## Risks / Trade-offs

- **[R]** 成员模型增加复杂度，配置文件更复杂 → 保留内置 agent 定义作为"启动模板"，leader 仍可覆盖
- **[R]** 成员间消息导致 token 消耗大增 → 消息默认截断（2KB），可配置
- **[R]** 多成员并发可能导致模型 API 限流 → 复用现有 maxWorkers 限流机制
- **[R]** 与现有 WorkerSnapshot 不兼容 → 保留 `WorkerSessionPoolLike` 兼容层一个版本，N+1 移除
- **[R]** Pi SDK 长期 idle 多 session 并发未验证 → 先做 2 成员原型，验证 `followUp` 在 `agent_end` 后可继续

## Oracle Technical Review — Mitigations Applied

以下内容基于 Oracle 评审反馈补充，解决运行时语义缺失问题。

### M1. 消息投递语义（Pull 模型）

消息 **不 push 注入**运行中的成员会话（Pi SDK `session.prompt` 阻塞期间无法注入）。采用 pull 模型：

- 成员完成当前任务（`agent_end`）后，`TeamSession` 自动检查该成员的收件箱
- 若有未读消息，执行 `session.followUp(message)` 注入消息上下文
- Leader 也可通过 `send-message` 在成员 idle 时手动触发 `startMember` 使其读取收件箱
- 成员 system prompt 中告知"完成每一步后检查是否有来自其他成员的消息"

### M2. 成员生命周期状态机

```
idle → working → done → (check inbox) → working | idle
            ↓
          error → idle（leader 决定 retry 或 remove）
            ↓
         cancelled → idle（释放会话资源）
```

### M3. 安全控制

- `send-message` 的 `from` 字段由 `TeamSession` **强制校验**：根据调用方 session 确定真实身份
- 成员 **不具有** `team` tool 中的 `create-member` / `assign-task` / `cancel` action
- 成员仅具有 `send-message` / `read-inbox` / `claim-task` 子集
- 消息广播速率限制：每成员每分钟最多 5 条，超限自动丢弃

### M4. 资源限制

- idle 成员总数上限 = `maxWorkers * 2`（默认 8）
- 消息历史保留最近 100 条，超限 FIFO 清除
- `createMember` 超限时返回错误而非静默拒绝

### M5. 迁移兼容

- V1（当前版本）：保留 `WorkerSessionPoolLike` 接口，`TeamSession` 实现该接口
- `spawnWorker` → 内部 `createMember` + `assignTask`
- `cancelWorker` → `cancelMember`
- `listWorkers` → `listMembers`（映射字段）
- V2（下一版本）：移除 `WorkerSessionPoolLike` 和 deprecated 导出
