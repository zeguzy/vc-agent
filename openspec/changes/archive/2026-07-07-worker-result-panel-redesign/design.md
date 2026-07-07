## Design: Worker 结果面板重设计 — 完整 summary + usage 透传

### Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        manager-v2.ts (TeamManager)                  │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ MemberState += turnCount, inputTokens, outputTokens,         │   │
│  │               cost, startedAt                                 │   │
│  └──────────────┬───────────────────────────────────────────────┘   │
│                 │ subscribe member session events                    │
│                 ▼                                                      │
│  ┌──────────────────────────────────────────────────────┐            │
│  │ on message_end (assistant msg):                       │            │
│  │   accumulate usage (turnCount++, tokens+=, cost+=)    │            │
│  │   (mirrors legacy WorkerSnapshot tracking)            │            │
│  └──────────────┬───────────────────────────────────────┘            │
│                 │ member completes                                    │
│                 ▼                                                      │
│  ┌──────────────────────────────────────────────────────┐            │
│  │ emit member_done {                                    │            │
│  │   memberName, summary,                                │            │
│  │   cost, inputTokens, outputTokens, turnCount,         │  ◄ NEW     │
│  │   durationMs: Date.now()-startedAt                    │            │
│  │ }  (was { memberName, summary, cost:0 })              │            │
│  └──────────────┬───────────────────────────────────────┘            │
└─────────────────┼────────────────────────────────────────────────────┘
                  │ TeamEvent (subscribeTeam)
                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    useSessionEvents.ts (TUI hook)                    │
│  member_done:                                                         │
│   existing worker msg → patch workerStatus='done' +                  │
│     workerSummary=summary, workerModel?, workerTurns,                │  ◄ NEW
│     workerTokensIn, workerTokensOut, workerDurationMs                │
│     (content UNCHANGED — streaming process preserved)                │
└─────────────────┬───────────────────────────────────────────────────┘
                  │ Message[]
                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│               MessageList.tsx → WorkerMessageView                     │
│                                                                       │
│   workerStatus === 'running'|'error'(active)   workerStatus === 'done'│
│   ┌─────────────────────────────┐         ┌─────────────────────────┐│
│   │ ◌ id/agent · running        │         │ ✓ id/role · done        ││
│   │ borderSoft, backgroundPanel │         │ borderDim               ││
│   │ (streaming content,         │         │ model · task · N turns  ││
│   │  scrollbox sticky bottom)   │         │ ─────────────────       ││
│   │                             │         │ (full summary markdown, ││
│   │                             │         │  scrollbox min3/max15)  ││
│   │                             │         │ $cost · k↑ k↓ · Xs      ││
│   └─────────────────────────────┘         └─────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
```

### Key Decisions

**D1: done 态显示 summary（交付物），而非流式过程全文**
- **Decision**：done 后结果区渲染 `member_done.summary`（member 的总结报告），不渲染流式 `content`。
- **Rationale**：summary 是 member 写给 Leader 的决策依据（结构化结论），流式 content 是过程噪音。running 态已实时展示过程，done 后 Leader 关心的是交付物。
- **Trade-off**：流式过程的细节在 done 后不再直接可见（如需可后续加折叠区，本期作为 Non-goal 排除）。

**D2: usage 采集复用 message_end 累积，而非新增独立计费通道**
- **Decision**：在 `manager-v2` 已订阅的 member session 事件流里，于 `message_end`（assistant 消息）时累加 `turnCount`/tokens/cost。
- **Rationale**：legacy `WorkerSnapshot`（`worker.ts:34`）已验证此模式可行；usage 数据天然随 agent 循环产生，无需独立计费服务。Pi SDK 的 `message_end` 事件 payload 含 usage（input/output tokens + cost）。
- **Trade-off**：依赖 Pi SDK `message_end` 暴露 usage 字段；若 SDK 某版本不提供，usage 回退为 0/缺失（UI 容错显示）。
- **MVP scope（cache tokens 排除）**：本期仅追踪 `inputTokens`/`outputTokens`/`cost`/`turnCount`/`durationMs`，**刻意不追踪 `cacheReadTokens`/`cacheWriteTokens`**（legacy `WorkerSnapshot` 有，影响 Anthropic 成本精度）。降低 plumbing 复杂度，作为后续扩展点。

**D3: usage 字段在 Message 上为可选，UI 容错渲染**
- **Decision**：`workerTurns`/`workerTokensIn` 等均为 `?` 可选，UI 渲染前判空（缺则不显示对应 meta/usage 片段）。
- **Rationale**：member_done 可能因错误路径中断（plumbing 未跑全），UI 不能因缺 usage 崩溃。
- **Trade-off**：UI 代码多处判空，略增复杂度，换取健壮性。

**D4: summary 与 streaming content 分离存储**
- **Decision**：member_done 时 summary 写入 `message.workerSummary`（新字段），不覆盖 `message.content`（流式过程保留）。
- **Rationale**：保留过程数据以备将来"展开过程"需求；当前 done 态优先渲染 summary。两个字段语义清晰。
- **Trade-off**：Message 多一个字段，内存开销可忽略。

**D5: durationMs 由 startedAt 计算，不新增独立计时器**
- **Decision**：member 创建时记录 `startedAt = Date.now()`，done 时 `durationMs = Date.now() - startedAt`。
- **Rationale**：成员生命周期已有创建点，无需额外定时器；计算成本低。
- **Trade-off**：时钟基于 wall-clock，含等待时间（非纯执行时间），但作为"成员占用时长"指标已足够。
- **关联（restoreMembers）**：`types-v2.ts` 的 `restoreMembers`（L269-395）恢复持久化成员时，也必须初始化全部 usage 字段（全 0 + `startedAt: Date.now()`），否则恢复成员完成时 `durationMs` 计算为 NaN。

**D6: 重入成员生命周期 — 终态消息不再被复用 patch**
- **Decision**：`member_done` 到达 `useSessionEvents` 时，若已存在的 worker 消息已是终态（done/error/cancelled），则**创建新的 worker 消息**（`createWorkerMessage` + usage patch）而非 patch 旧消息，并更新 `workerMsgMap` 指向新消息。
- **Rationale**：member 完成→idle→重新激活→再次完成的场景下，`workerMsgMap` 仍指向首条消息；复用 patch 会导致 usage 合并错误、summary 覆盖、status 闪烁。
- **Trade-off**：同一 member 多次完成会产生多条消息（符合"多次交付"语义）。

**D7: cancelled 成员留作已知 MVP 行为（不在本期处理）**
- **Decision**：`member_cancelled` 事件（`manager-v2.ts` L574-594）无 usage payload，且 `useSessionEvents` 当前不处理该事件——被取消的成员会留下一条永久的 running 消息。
- **Rationale**：cancel 语义（强制中断）与 done/error 不同，usage 统计无意义；本期聚焦"正常完成结果展示"。完整 cancel-handling 列为后续增强。
- **Trade-off**：本期 UI 上 cancelled 成员显示为"running 卡住"——已知缺陷，不影响 done 路径正确性。

### Data Flow

```
member session: assistant message_end event
        │
        ▼
manager-v2: MemberState.usage += event.usage  (turnCount++, tokens, cost)
        │
        ▼  (member finishes)
manager-v2: emit member_done { summary, cost, tokens, turns, durationMs }
        │
        ▼
useSessionEvents: patch worker Message { workerStatus='done',
        │        workerSummary=summary, workerTurns, workerTokens*, workerDurationMs, workerModel }
        │
        ▼
MessageList → WorkerMessageView
        │
        ├─ running/error → streaming box (borderSoft, content scrollbox)
        └─ done → result card (borderDim, workerSummary markdown scrollbox, usage row)
```

### Files

```
src/
├── message.ts                          M  (+ worker* fields, - createWorkerSummaryMessage)
├── tui/
│   ├── components/
│   │   └── MessageList.tsx             M  (WorkerMessageView 2态, - WorkerSummaryView, - worker-summary route)
│   └── hooks/
│       └── useSessionEvents.ts         M  (member_done: store summary+usage)
└── teams/
    ├── types-v2.ts                     M  (MemberState +usage, TeamEvent.member_done +usage)
    └── manager-v2.ts                   M  (subscribe message_end, accumulate usage, emit rich member_done)
openspec/changes/worker-result-panel-redesign/
├── specs/
│   ├── tui-messages/spec.md            M  (delta: worker result rendering)
│   └── team-orchestration/spec.md      M  (delta: member_done usage payload)
├── proposal.md                         ✚
├── design.md                           ✚
└── tasks.md                            ✚
```
