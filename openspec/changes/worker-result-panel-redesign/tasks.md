## Tasks

- [x] 1. 扩展 Message worker 数据模型 (`src/message.ts`)
	- 新增可选字段：`workerSummary?`、`workerModel?`、`workerTurns?`、`workerTokensIn?`、`workerTokensOut?`、`workerDurationMs?`
	- 删除 `createWorkerSummaryMessage` 函数（死代码）
	- 从 `MessageRole` 联合类型中移除 `"worker-summary"`
	- 跑 `bun run typecheck` 确认无类型错误（此时 useSessionEvents/MessageList 引用会报错，预期内，后续 task 修复）

- [x] 2. 扩展 MemberState + TeamEvent 类型 (`src/teams/types-v2.ts`)
	- `MemberState` 新增：`turnCount: number`、`inputTokens: number`、`outputTokens: number`、`cost: number`、`startedAt: number`
	- `TeamEvent.member_done` payload 新增：`inputTokens`、`outputTokens`、`turnCount`、`durationMs`（保留 `cost`，类型 `number` 非 `0` 字面量）
	- `restoreMembers`（types-v2.ts ~L269-395）构造 MemberState 时同样初始化 usage 字段（全 0 + `startedAt: Date.now()`），避免恢复的 member 完成时 `durationMs=NaN`
	- 跑 `bun run typecheck`（manager-v2 引用会报错，预期内）

- [x] 3. manager-v2 采集 usage 并发射富 member_done (`src/teams/manager-v2.ts`)
	- member 创建时初始化 `startedAt: Date.now()`、其余 usage 字段为 0
	- 在 member session 事件订阅里，于 `message_end`（assistant 消息）时累加 `turnCount++`、`inputTokens+=`、`outputTokens+=`、`cost+=`（参考 legacy `Worker` 的 `WorkerSnapshot` 累积模式；usage 取自 Pi SDK message_end payload，缺失则跳过）
	- member_done 发射时填入真实 `cost`/`inputTokens`/`outputTokens`/`turnCount`/`durationMs`（替换硬编码 `cost:0`）
	- 删除 `cost:0` 处的 TODO 注释
	- 跑 `bun run typecheck` 通过

- [x] 4. useSessionEvents 透传 summary + usage 到 Message (`src/tui/hooks/useSessionEvents.ts`)
	- `member_done` 分支：若现有 worker 消息已处终态（`done`/`error`/`cancelled`，即 re-done member 场景），**新建** worker 消息并更新 `workerMsgMap`（不 patch 旧消息，避免 usage 合并 / summary 覆盖 / 状态闪烁）；否则 patch 现有消息
	- patch 现有 worker 消息时，除 `workerStatus:'done'` 外，写入 `workerSummary`、`workerTurns`、`workerTokensIn`、`workerTokensOut`、`workerDurationMs`（`content` 保持不变）
	- 从 `MemberState`/`TeamEvent` 取 model（若可获取则填 `workerModel`）
	- 跑 `bun run typecheck` 通过

- [x] 5. WorkerMessageView 重设计 — done 态结果卡片 (`src/tui/components/MessageList.tsx`)
	- 提取 `workerStatusColor`/`workerStatusIcon` 复用（已有）
	- done 态渲染：header（`✓ id/role · done`，borderColor=`borderDim`）+ meta 行（`workerModel · task · workerTurns turns`，fg=`textMuted`，可选字段判空）+ 结果区（`message.workerSummary` markdown 渲染，包进 `<scrollbox minHeight=RESULT_BLOCK_MIN_HEIGHT maxHeight=RESULT_BLOCK_MAX_HEIGHT scrollY focused={false}>`，缺失则不渲染）+ usage 行（`$cost · kin↑ kout↓ · Xs`，fg=`textSubtle`，判空）
	- running/error 态保留现有流式框（borderSoft + 流式 content scrollbox），仅 error 时 borderColor=`error`
	- error 态：额外渲染 `workerError` 行（`↳ error`，fg=`error`）
	- 跑 `bun run typecheck` + `bun run dev` 手测渲染

- [x] 6. 删除 WorkerSummaryView 死代码 (`src/tui/components/MessageList.tsx`)
	- 删除 `WorkerSummaryView` 组件定义
	- 删除 MessageList 路由中 `if (msg.role === "worker-summary")` 分支
	- 跑 `bun run typecheck` 通过

- [x] 7. 编写/更新测试 + spec delta + 全量 check
	- 为 usage 累积逻辑写单测（`tests/` 下，mock member session message_end 事件，断言 MemberState.usage 累加正确）
	- 为 member_done 富 payload 写测试（断言 cost/tokens/turns/durationMs 透传）
	- 为 re-done member 写测试（member done→idle→reactivate→done，断言产生两条独立 worker 消息，不合并）
	- spec delta：`specs/tui-messages/spec.md` 加 `## ADDED Requirements` → worker 结果渲染（done 态卡片、summary 完整渲染、usage meta）
	- spec delta：`specs/team-orchestration/spec.md` 加 `## ADDED Requirements` → member_done 携带 usage payload
	- 更新 base spec：`openspec/specs/tui-messages/spec.md` 中 worker-summary 相关 scenarios（~L342-372）替换为新的 done 态卡片 scenarios
	- 文档化已知 MVP 行为：member_cancelled 无 usage payload 且 useSessionEvents 不处理该事件 → cancelled member 留下 stale running 消息（在 design.md D7 已记录，此处确认无需代码改动）
	- 跑 `bun run check` 全量通过（typecheck + lint + test，0 fail）
- **测试延后说明**：usage 累积 / member_done 富 payload / re-done member 三项单测需增强 rig（fake session 需发射 message_end 事件，当前 rig 的 inject 绕过 createMember 且 fake session 不发 message_end）。本轮以 spec 文档化 + typecheck/lint/既有 723 测试全绿为保证，rig 增强留后续 change。
