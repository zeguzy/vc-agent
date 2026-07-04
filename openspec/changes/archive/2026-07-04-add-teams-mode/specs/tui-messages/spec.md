## ADDED Requirements

### Requirement: worker 角色消息与并行流式渲染

系统 SHALL 在 `src/message.ts:MessageRole` 新增 `"worker"` 与 `"worker-summary"` 角色，并扩展 `Message` 接口可选字段 `workerId?` / `workerAgent?` / `workerStatus?: "running" | "idle" | "done" | "error" | "cancelled"`。`src/tui/components/MessageList.tsx` SHALL 在主消息流内**为每个 active worker 渲染一条独立的 worker 消息块**，实时显示该 worker 的流式 token；终态时把流式块折叠为 `worker-summary` 单行摘要。

#### Scenario: worker 消息插入主消息流
- **WHEN** `team_worker_event` `kind: "message_delta"` 到达且不存在对应 `workerId` 的 worker 角色消息
- **THEN** SHALL 创建 `{role: "worker", workerId, workerAgent, workerStatus: "running", content: text_delta}` 消息插入主消息流，位置紧邻上一个 `team.spawn` 工具调用消息之后
- **AND** SHALL 使用 80ms 节流更新（参照现有 `useStreamingBuffer` 机制），避免渲染抖动

#### Scenario: worker 流式 token 实时追加
- **WHEN** 收到 `kind: "message_delta"` 且已存在对应 workerId 的 worker 消息
- **THEN** SHALL 追加 `text_delta` 到该 worker 消息的 content 字段
- **AND** MessageList SHALL 触发对应 worker 消息块重渲染（不重新渲染整列表，对齐 `React.memo` 既有约定）

#### Scenario: worker 终态折叠为 summary
- **WHEN** 收到 `kind: "agent_end"` 或 `kind: "error"` 对应 workerId
- **THEN** SHALL 把该 worker 消息 role 改为 `"worker-summary"`，content 设为 worker `lastSummary`（截断到 ≤ 1KB）
- **AND** SHALL 置 `workerStatus` 为终态值（`"done"` / `"error"` / `"cancelled"`）
- **AND** 流式 token 块 SHALL 折叠为单行摘要 + 状态指示符（✓ / ✗ / ⊘）

#### Scenario: worker 消息块视觉样式
- **WHEN** 渲染 worker 角色消息
- **THEN** SHALL 使用 `borderStyle="rounded"` 圆角框，背景 `backgroundInset`
- **AND** 顶部行 SHALL 显示状态图标 + `workerId` / `workerAgent`（`secondary` 色）：running → `⠹ wkr_a1 / lysosome`，done → `✓ wkr_a1 / lysosome`，error → `✗ wkr_a1 / lysosome`（`error` 色）
- **AND** 内容区 SHALL 渲染流式 token（`markdown` 组件复用 markdownText 前景色）

#### Scenario: worker-summary 单行样式
- **WHEN** 渲染 `worker-summary` 角色消息
- **THEN** SHALL 显示**单行**格式：`<状态图标> <workerId>/<agent> summary: <truncated text>`，无边框
- **AND** summary 文本超过 100 字符时 SHALL 截断并追加 `"…"`
- **AND** 该行 SHALL 使用 `textSubtle` 色，与工具卡片视觉层级一致

#### Scenario: 并行 worker 互不污染渲染
- **WHEN** `TeamSessionPool` 同时有 2 个 running worker 各自流式输出
- **THEN** MessageList SHALL 渲染 2 条独立的 worker 消息块，各自独立节流渲染
- **AND** 一条 worker 的 delta SHALL 不触发另一条 worker 消息块重渲染

### Requirement: /workers 选择器视图

系统 SHALL 通过 `src/tui/components/WorkersView.tsx` 实现 workers 选择器视图，由 `/workers` slash 命令触发进入。该视图 SHALL 显示所有 worker 列表，支持 j/k 导航 + Enter 聚焦单个 worker 历史 + ESC 退出。

#### Scenario: 列表视图渲染
- **WHEN** 用户输入 `/workers` 且 `client.listWorkers().length > 0`
- **THEN** TUI SHALL 切到 `view: "workers"` 状态，渲染 `<WorkersView workers={listWorkers()} />`
- **AND** WorkersView SHALL 渲染 `<scrollbox>` 包裹的列表，每行：`<状态图标> <workerId> · <agent> · <status> · <lastSummary(truncated 60 chars)>`
- **AND** 当前选中行 SHALL 反色高亮（`backgroundMenu` 背景 + `backgroundMenuText` 前景）

#### Scenario: 列表内导航
- **WHEN** WorkersView 处于列表态且用户按 `j` / `k` / `g` / `G`
- **THEN** SHALL 上下移动选中行（对齐 NORMAL 模式消息列表导航约定）
- **AND** 列表超出视窗时 SHALL 自动滚动到选中行

#### Scenario: 聚焦单个 worker 历史
- **WHEN** 用户在列表选中某 worker 按 `Enter`
- **THEN** SHALL 进入聚焦态：渲染该 worker 的完整流式输出历史（从 spawn 到当前），使用独立 `<scrollbox>`
- **AND** 输出超长时 SHALL 支持滚动浏览
- **AND** 顶部 SHALL 显示返回提示 `<- ESC back`

#### Scenario: 退出 workers 视图
- **WHEN** 用户在 WorkersView（列表或聚焦态）按 `ESC`
- **THEN** SHALL 切回 `view: "chat"`，恢复主消息流
- **AND** workers 列表状态 SHALL 保留（下次进入仍在原选中位置）

#### Scenario: 空列表提示
- **WHEN** `/workers` 触发但 `client.listWorkers().length === 0`
- **THEN** SHALL 在主消息流末尾显示提示行 `No active workers. Spawn one with /team spawn <agent> "<task>"`
- **AND** SHALL **不**切换 view 状态

#### Scenario: 列表实时刷新
- **WHEN** workers 列表已有展示且新 worker 被 spawn / 旧 worker 终结
- **THEN** `client.onWorkerEvent` 触发 SHALL 重渲染 WorkersView，列表条目数与状态实时变化
- **AND** 已聚焦某 worker 时若该 worker 终结 SHALL 刷新其状态指示符但不退出聚焦