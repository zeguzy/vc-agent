# tui-messages Specification Delta

## ADDED Requirements

### Requirement: Worker 结果卡片渲染

团队模式下，成员（worker）完成任务后，其结果消息在主消息列表中以「结果卡片」形式渲染，完整展示成员交付报告与资源消耗。

#### Scenario: done 态显示完整 summary

- **WHEN** 一条 `worker` 消息的 `workerStatus` 变为 `"done"`，且携带 `workerSummary`（非空）
- **THEN** `WorkerMessageView` 渲染结果卡片：header（`✓ id/role · done`）+ 结果区（`workerSummary` 完整 markdown，scrollbox minHeight3/maxHeight15）
- **AND** summary 不再被截断为 100 字符
- **AND** borderColor 为 `borderDim`（done 语义）

#### Scenario: running 态保留流式框

- **WHEN** 一条 `worker` 消息的 `workerStatus` 为 `"running"`
- **THEN** 渲染流式输出框（borderColor `borderSoft`），内容区为 `content` 流式全文，scrollbox sticky 跟随到底部
- **AND** done 后不回退到此态

#### Scenario: usage meta 行

- **WHEN** done 态消息携带 `workerModel` 和/或 `workerTurns`
- **THEN** 结果卡片在 summary 上方渲染 meta 行（`model · task · N turns`）
- **AND** 任一字段缺失则省略该片段（容错渲染）

#### Scenario: usage 行

- **WHEN** done 态消息携带 cost/tokens/durationMs（任一非空）
- **THEN** 结果卡片在 summary 下方渲染 usage 行（`$cost · kin↑ kout↓ · Xs`，fg=`textSubtle`）
- **AND** 缺失字段不渲染（UI 不因缺 usage 崩溃）

#### Scenario: error 态

- **WHEN** 一条 `worker` 消息的 `workerStatus` 为 `"error"`
- **THEN** 渲染结果卡片，borderColor 为 `error`
- **AND** 若有 `workerError`，在结果区下方渲染 `↳ error` 行（fg=`error`）

### Requirement: 移除 worker-summary 死代码

- **WHEN** `worker-summary` MessageRole 及 `WorkerSummaryView` 组件已无调用方
- **THEN** 从 `MessageRole` 联合类型、`createWorkerSummaryMessage`、`WorkerSummaryView` 组件、MessageList 路由分支中移除
- **AND** 不影响 `worker` 角色消息的正常渲染
