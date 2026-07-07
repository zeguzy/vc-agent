## Proposal: Worker 结果面板重设计 — 完整 summary + usage 透传

### Background

团队模式下，成员（member/worker）完成任务后返回给 Leader 的「结果框」体验差，根源有三：

1. **member 的交付报告被丢弃**。`member_done` 事件携带的 `summary`（member 写给 Leader 的最终总结）在"已有流式消息"分支只 patch 了 `workerStatus`，`summary` 直接丢了（`useSessionEvents.ts:193`）。Leader 只能看到 member 流式过程的全文，看不到 member 精心总结的结果。
2. **cost/tokens/turns/耗时 全无**。`member_done.cost` 硬编码 `0`（`manager-v2.ts:1054` TODO），plumbing 未打通，Leader 无法评估成员的资源消耗。
3. **`WorkerSummaryView` 是死代码**。`createWorkerSummaryMessage` 全项目无调用方，`worker-summary` 角色消息从不创建，但代码和路由分支仍残留。

结果：Leader 的决策依据（成员交付物 + 资源消耗）在 UI 上几乎不可见。

### Features

1. **Worker 结果卡片（done 态）**。`WorkerMessageView` 按 `workerStatus` 分两态渲染。done 态转为结果卡片：header（`✓ name/role · done`，`borderDim`）+ meta 行（model · task · turns）+ 结果区（member 的完整 `summary`，markdown 渲染 + scrollbox minHeight3/maxHeight15，不再截断 100 字）+ usage 行（$cost · tokens↑↓ · 耗时）。running 态保留当前流式框（`borderSoft` + 流式 content + sticky scrollbox）。

2. **Usage 数据透传**。`Message` 扩展 worker 字段（`workerSummary`、`workerModel`、`workerTurns`、`workerTokensIn`、`workerTokensOut`、`workerDurationMs`）。`member_done` 事件处理：summary → `workerSummary`（不覆盖流式 content，保留过程），同时 patch usage 字段。

3. **Usage 采集 plumbing**。`MemberState` 增加 `turnCount`/`inputTokens`/`outputTokens`/`cost`/`startedAt`。`manager-v2` 订阅 member session 的 `message_end`，按消息累积 usage（参考 legacy `Worker` 的 `WorkerSnapshot`）。`TeamEvent.member_done` payload 扩展真实 `cost`/`inputTokens`/`outputTokens`/`turnCount`/`durationMs`（替换硬编码 `cost:0`）。

4. **死代码清理**。删除 `createWorkerSummaryMessage`、`WorkerSummaryView` 组件、`worker-summary` MessageRole 及其 MessageList 路由分支。

### Non-goals

- 不重设计 `WorkersView` 全屏 overlay 面板（成员列表 + 聚焦详情）
- 不重设计 `TeamTopology` 输入框上方树
- 不改 running 态流式输出框的展示行为（已在 scrollbox commit 完成）
- 不加可展开/折叠的"过程详情"区（done 后只显示 summary 交付物；流式过程在 running 态已实时展示）
- 不持久化 usage 到磁盘（usage 仅当前会话内存态）
- 不改 `subagent` 工具结果展示（已在 scrollbox commit 完成）
