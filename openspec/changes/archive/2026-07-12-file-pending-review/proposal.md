## Why

当前 AI agent 修改文件时采用"逐次审批"模式（EditConfirmBridge 阻塞等待用户 Accept/Reject），每次 edit 工具调用都暂停 agent 执行等待用户决定。这导致：(1) agent 无法连续生成多文件变更，频繁打断用户；(2) 用户无法在所有变更完成后整体审查；(3) 无法按 hunk 粒度选择性接受部分变更。Trae/Cursor/VS Code 等 IDE 均已采用"先写入→事后审查"模式，用户在 agent 完成后统一审查所有变更，体验显著更好。

## What Changes

- 新增 `DiffReviewManager`：管理所有待审查文件的状态（原始快照、hunks、pending/accepted/rejected），替代现有 EditConfirmBridge 的逐次阻塞模式
- 新增 `FileChangeStore`：存储文件变更记录（filePath → { originalContent, hunks, status }），提供 accept/reject/acceptAll/rejectAll API
- 修改 `createEditTool`：edit 工具写入文件时，通过 DiffReviewManager 记录快照和变更，不再阻塞等待用户确认
- 新增 TUI `PendingReviewBar` 组件：在输入框上方显示待审查文件列表（N files pending），支持批量 Accept All / Reject All
- 新增 TUI `DiffReviewView` 组件：全屏 diff 审查视图，逐文件显示变更，支持逐 hunk Accept/Reject
- 修改 `App.tsx`：集成 PendingReviewBar 和 DiffReviewView，添加键盘快捷键（`Ctrl+R` 进入审查视图）
- Reject 时从快照恢复原始文件内容

## Capabilities

### New Capabilities

- `diff-review`: 文件变更待审查系统——快照管理、hunk 状态追踪、Accept/Reject 操作、文件回滚

### Modified Capabilities

## Impact

- `src/tools/edit.ts`：createEditTool 的 writeFile 不再阻塞等待确认，改为写盘后记录到 DiffReviewManager
- `src/tools/edit-confirm-bridge.ts`：保留但降级为可选（非交互模式仍可用），主路径切换到 DiffReviewManager
- `src/tui/App.tsx`：新增 PendingReviewBar 和 DiffReviewView 集成
- `src/tui/components/`：新增 PendingReviewBar.tsx、DiffReviewView.tsx
- `src/agent/session.ts`：createSession/createRuntime 传入 DiffReviewManager 替代 EditConfirmBridge
- `src/client/`：AgentClient 接口新增 pendingReview 相关方法
- 无新增外部依赖（diff 计算使用 Pi SDK 已有的 unified patch 生成）

## Non-goals

- 不做 hunk 级 PositionTracker（MVP 阶段按文件粒度 Accept/Reject，hunk 级仅展示）
- 不做按消息回滚（不支持删除某条消息后回滚其变更）
- 不做跨文件 hunk 键盘导航（MVP 阶段用文件列表导航）
- 不做 diff 审查持久化（关闭 TUI 后待审查状态丢失，与现有 session 持久化独立）
- 不做 Source Control 集成（暂不与 git staging 联动）
- 不做 auto-accept 定时器（后续迭代）
- 不做重叠检测和自动拒绝重叠 hunk（MVP 阶段文件粒度操作，不存在重叠问题）
