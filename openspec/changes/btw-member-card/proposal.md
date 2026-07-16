## Why

当前 `/btw` 实现用 `createBranchedSession` + `switchSession`，fork 全部历史到新会话。用户体验混乱——看到的是历史堆叠而非"后台任务卡片"。用户期望：`/btw` 后当前任务变成一个类似 team member 的后台卡片，新对话是干净的空白会话，后台任务完成时结果自动回传。

## What Changes

- **废弃 `createBranchedSession` + `switchSession` 模式**：不再 fork 历史、不再切换 session
- **改用"视图切换"模式**（同 `activeMemberName` 模式）：`/btw` 后 TUI 切换到查看后台任务 session 的消息，主 session 保持不变
- **新增 `BtwBackgroundTask` 类型**：持有独立 `AgentSession` + subscribe 句柄 + 状态追踪，类似简化版 `MemberState`
- **新增 `btwBackgroundTask` TUI 状态**：类似 `activeMemberName`，控制 TUI 显示哪个 session 的消息
- **后台任务卡片 UI**：在 TeamTopology 区域或独立区域显示后台任务状态行（spinner + 任务摘要）
- **结果回传**：后台任务完成时，通过 `injectNotification()` 向主 session 注入完成通知
- **`/btw back` 改为视图切回**：不再 `switchSession`，只是 `setBtwBackgroundTask(null)` 回到主视图
- **移除 `preserveBackground` hack**：不再需要，因为没有 session 切换

## Capabilities

### New Capabilities

- `btw-background-task`: 后台任务生命周期管理——创建独立 AgentSession、订阅事件、追踪状态、完成时通知主 session
- `btw-card-ui`: TUI 后台任务卡片——在 TeamTopology 下方显示后台任务状态行，支持点击/快捷键切回

### Modified Capabilities

- `btw-side-conversation`: 从 session-fork 模式改为 view-switch 模式，不再复制历史、不再切换 session
- `team-topology-view`: 渲染区域扩展，在 member 列表下方追加后台任务行

## Impact

- **Server 层**：`handleBtwEnter` 重写（创建独立 session 而非 fork）、`handleBtwBack` 简化（视图切回而非 session 切换）、移除 `preserveBackground`
- **TUI 层**：新增 `btwBackgroundTask` 状态、`displayMessages` 扩展（类似 `activeMemberName` 分支）、TeamTopology 扩展（后台任务行）
- **Client 层**：`BtwEnterResult` 扩展（含 background task session 引用信息）、新增 `getBtwBackgroundTask()` 方法
- **Session 层**：`btw.ts` 重写——`BtwState` → `BtwBackgroundTask`，`createBackgroundMonitor` 适配新架构
- **Commands 层**：`/btw` 命令 handler 重写——不再追加 separator 消息，改为设置 TUI 状态

## Non-goals

- 不实现多后台任务并行（一次只允许一个 /btw 后台任务）
- 不实现后台任务的持久化/恢复（重启后丢失）
- 不复用 TeamManager.createMember（后台任务不需要 team 文件系统、memory/message 工具、TEAM.md）
- 不实现后台任务的中断/取消（用户只能切回查看，不能中途停止）
