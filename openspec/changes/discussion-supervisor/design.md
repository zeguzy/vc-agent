## Context

当前团队讨论模式的实现链路为：

```
Leader → team(action="assign", type=不可达) → assignTask(memberName) → member agent_end
  → handleMemberEvent(task.type === "discussion") → evaluateDiscussion
  → runCoordinator(新session, 无状态) → continue/complete → steer/prompt next member
```

存在三个结构性问题：

1. **Leader 轮询**：`ensureSubscribed`（`src/server/index.ts:173`）中 `member_done` 事件通过 `steer(note)` 注入，LLM 当作"需要行动的新信息"；`TEAM_ORCHESTRATOR_PROMPT` 说 "stop talking" 但 LLM 经常不遵守，因为 `team(action="read")` 和 `team(action="wait")` 太容易触发轮询循环。
2. **Coordinator 弱监督**：每轮创建新 session 无跨轮记忆；prompt 只传 title/description 没有议题分解；只有 continue/complete 两个 action 没有 redirect。
3. **讨论类型不可达**：`team` 工具的 assign action 没有 `type` 参数；`TeamManagerLike.assignTask` 也没有。

## Goals / Non-Goals

**Goals:**
- Leader 分配任务后真正等待，只在收到事件时被动响应
- Supervisor 能跟踪议题、检测偏移、强制拉回、跨轮保持状态
- Leader 能通过 team 工具创建 discussion 类型任务
- 讨论任务支持多成员参与

**Non-Goals:**
- 不改 Pi SDK（steer/prompt 语义不变）
- 不改 member system prompt L1-L5 层级
- 不实现 Supervisor compaction
- 不实现讨论结果自动持久化
- 不实现讨论实时 UI 面板
- 不改 wait action 实现（只改 prompt 描述）

## Decisions

### D1: Leader 通知改为结构化系统标记

**决策**：`ensureSubscribed` 中 `member_done` 通知改为 `[SYSTEM NOTIFICATION — DO NOT ACT unless there's a problem]` 包裹，非 streaming 时不主动 prompt Leader。

**替代方案**：
- A) 引入新的 session API（如 `session.notify()`）区分通知和对话 → 需改 Pi SDK，成本太高
- B) 完全不注入通知，Leader 只能通过 `team(action="read")` 获取状态 → 回到轮询问题
- C) 用 system message 而非 steer → Pi SDK 不支持 system message 注入

**选择理由**：方案 A 最理想但需改 SDK；方案 B 是退化；方案 C 不可行。当前选择在 steer 文本中用明确标记包裹是 SDK 约束下的最优解。

### D2: Supervisor 复用同一 session 保持跨轮状态

**决策**：`DiscussionSupervisor` 类持有自己的 `AgentSession`，通过 `steer` 注入每轮新信息，而非每轮创建新 session。

**替代方案**：
- A) 每轮创建新 session（当前做法）→ 无跨轮记忆，无法跟踪议题状态
- B) 用文件持久化议题状态，每轮新 session 读文件 → 增加磁盘 I/O 和解析复杂度
- C) 复用 session + steer → 跨轮记忆天然存在，最简单

**选择理由**：方案 C 最直接，与 Pi SDK 的 steer 机制完美配合。长讨论 context 膨胀问题留后续通过 compaction 解决（Non-goal）。

### D3: redirect 用 directMember 而非 steer

**决策**：Supervisor 的 `redirect` action 用 `TeamManager.directMember(name, "redirect", instruction)` 注入，而非 `session.steer(instruction)`。

**理由**：`directMember` 的 redirect 在 member 看来是 leader 级别的指令（注入到 system prompt 层），比 steer（注入到 conversation 层）有更高的优先级。这保证了"强制拉回"的语义。

### D4: TaskState.participants 与 memberName 共存

**决策**：`TaskState` 新增 `participants: MemberName[]` 字段，保留 `memberName` 字段。讨论任务的 `memberName` 为 null，`participants` 为参与者列表。执行任务的 `participants` 为 `[memberName]`。

**替代方案**：
- A) 去掉 memberName，统一用 participants → 破坏大量现有代码的 `task.memberName` 引用
- B) memberName 和 participants 共存 → 兼容性最好，渐进迁移

**选择理由**：方案 B 避免破坏性变更。memberName 继续用于执行任务，participants 用于讨论任务。

### D5: startDiscussion 作为 TeamManager 新方法

**决策**：新增 `TeamManager.startDiscussion(opts)` 方法，接受 `participants` 数组和可选的 `plan` 参数。

**理由**：不在 `assignTask` 上重载——assignTask 的语义是"给一个 member 分配一个任务"，讨论的语义是"启动多人讨论"。两个概念不同，值得独立方法。

### D6: Supervisor prompt 包含议题分解和偏移检测

**决策**：Supervisor prompt 包含三个关键增强：
1. **Agenda 跟踪**：传入 `DiscussionPlan`（含 `agenda: AgendaItem[]`），每轮更新议题状态
2. **偏移检测指令**：明确要求 Supervisor 检查"最近消息是否偏离了讨论目标"，如果偏移则发出 redirect
3. **Scope 边界**：传入 `scope` 和 `offTopicSignals` 字段，帮助 Supervisor 判断什么算偏题

## Risks / Trade-offs

- **[Risk] steer 标记可能被 LLM 忽略** → 缓解：同时在 TEAM_ORCHESTRATOR_PROMPT 中增加强等待指令，双重约束
- **[Risk] Supervisor session context 膨胀** → 缓解：当前 Non-goal，后续加 compaction；短期内 DISCUSSION_MAX_ROUNDS=10 限制了 context 上限
- **[Risk] redirect 仍可能被 member LLM 忽略** → 缓解：在 member 的 Anti-Patterns 中加入"必须遵循 supervisor redirect 指令"约束
- **[Risk] memberName/participants 共存增加理解成本** → 缓解：JSDoc 明确说明两者关系，执行任务用 memberName，讨论任务用 participants
- **[Trade-off] 非 streaming 时不主动 prompt Leader** → 用户可能觉得 Leader "不作为"。TUI 层已有 team event 订阅展示状态变化，应该够用

## Open Questions

- 无
