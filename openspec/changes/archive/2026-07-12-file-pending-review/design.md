## Context

当前 vc-agent 的文件修改采用"逐次审批"模式：Pi SDK 的 `edit` 工具每次调用 `operations.writeFile` 时，通过 `EditConfirmBridge` 阻塞 agent 执行，等待用户在 `DiffConfirmBox` 中点击 Accept/Reject。这导致 agent 无法连续生成多文件变更，频繁打断用户。

现有关键组件：
- `createEditTool(cwd, bridge?)` — 编辑工具，bridge 存在时走确认流程
- `EditConfirmBridge` — 单次确认桥接，pending/resolve/reject 三件套
- `DiffConfirmBox` — TUI 确认组件，显示 unified patch + Accept/Reject 按钮
- `EditDiffView` — 只读 diff 渲染组件（`<diff>` OpenTUI 内置）
- `generateUnifiedPatch()` — 生成 unified diff 字符串

约束：
- Pi SDK 的 `edit` 工具执行在 `operations.writeFile` 回调中，同步/异步均可
- OpenTUI 已内置 `<diff>` 组件，支持 unified/split 视图、语法高亮、行号
- TUI 是全屏 alternate screen buffer，无法弹出独立窗口
- Agent 是单线程顺序执行工具调用，不需要处理并发写入同一文件

## Goals / Non-Goals

**Goals:**
- Agent 连续执行文件修改不被打断
- 用户在 agent 完成后统一审查所有变更
- 按文件粒度 Accept/Reject，Reject 时恢复原始内容
- 在 TUI 输入框上方显示待审查文件列表
- 支持全屏 diff 审查视图，逐文件浏览变更
- 支持 Accept All / Reject All 批量操作

**Non-Goals:**
- 不做 hunk 级 PositionTracker（MVP 按文件粒度操作）
- 不做按消息回滚
- 不做持久化（关闭 TUI 后待审查状态丢失）
- 不做 Source Control 集成
- 不做 auto-accept 定时器
- 不做重叠检测

## Decisions

### D1: 写入策略——先写盘后审查

**选择**：edit 工具直接写盘（不阻塞），同时在 DiffReviewManager 中记录快照和变更。
**理由**：与 Trae/Cursor/VS Code 一致，agent 可以连续执行。Reject 时从快照恢复。
**替代方案**：(A) 写入虚拟缓冲区，Accept 后才写盘——增加复杂度，且 Pi SDK 的 edit 工具依赖磁盘文件做 diff 计算。(B) 保持现状逐次审批——用户体验差。

### D2: 状态模型——文件级扁平模型

**选择**：`Map<filePath, FileChange>` 其中 `FileChange = { originalContent, currentContent, status, hunks }`，状态为 pending/accepted/rejected。
**理由**：MVP 阶段不做 hunk 级 Accept/Reject，三级级联（ResponseGroup→FileChange→Hunk）过度设计。文件级足够覆盖核心场景。
**替代方案**：三级级联模型（Skycode 模式）——更适合支持消息回滚，但 MVP 不需要。

### D3: DiffReviewManager 作为独立服务

**选择**：`DiffReviewManager` 是独立模块（`src/diff-review/manager.ts`），通过事件机制与 TUI 通信。
**理由**：与 EditConfirmBridge 不同，审查生命周期跨越多次工具调用和整个 agent turn，需要独立状态管理。事件机制（EventEmitter）让 TUI 可以订阅变更而无需轮询。
**替代方案**：在 App.tsx 中用 React state 管理——状态与组件耦合，难以在工具执行层访问。

### D4: TUI 集成方式——PendingReviewBar + DiffReviewView

**选择**：
- `PendingReviewBar`：固定在输入框上方，显示待审查文件数量和文件列表，支持键盘操作
- `DiffReviewView`：全屏视图（类似 SettingsPanel/SessionPicker 的 overlay 模式），逐文件显示 diff，Accept/Reject 当前文件
**理由**：PendingReviewBar 常驻提示，不占用消息流空间；DiffReviewView 全屏展示 diff 更清晰。overlay 模式与现有 SettingsPanel/SessionPicker 一致。
**替代方案**：在消息流中内嵌 diff 视图——diff 内容会很长，打乱对话流。

### D5: 快照存储——内存 Map

**选择**：`Map<filePath, string>` 存储原始文件内容（第一次写入前的磁盘内容）。
**理由**：MVP 不需要持久化，内存存储最简单。文件内容通常不大（<1MB），agent 单次会话修改的文件数量有限（<50）。
**替代方案**：临时文件存储——增加 I/O 和清理逻辑，内存已足够。

### D6: Reject 回滚——完整文件恢复

**选择**：Reject 时将 `originalContent` 整体写回文件。
**理由**：MVP 按文件粒度操作，不存在部分 hunk 已 accept 部分需 reject 的情况。完整恢复最安全，不需要 PositionTracker。
**替代方案**：hunk 级精确恢复——需要 PositionTracker 和内容验证，MVP 不需要。

### D7: Pi SDK 集成——替换 operations.writeFile

**选择**：修改 `createEditTool` 的 `operations.writeFile`，在写盘前记录快照，写盘后通知 DiffReviewManager。
**理由**：最小侵入，不需要修改 Pi SDK 本身。operations 回调是 SDK 提供的扩展点。
**注意**：需要同时处理 `edit` 工具（修改文件）和 `write` 工具（创建新文件）两种场景。

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| 用户关闭 TUI 后待审查状态丢失 | MVP 可接受；后续可序列化到 session 存储 |
| Agent 多次修改同一文件，originalContent 只记录第一次 | 设计如此——快照是"agent 修改前"的基线，多次修改在同一快照上叠加 |
| Reject 整个文件可能丢弃用户想保留的部分变更 | MVP 范围限制；后续迭代加 hunk 级 Accept/Reject |
| edit 工具不再阻塞，agent 可能在用户审查前继续修改已 pending 的文件 | DiffReviewManager 检测到已 pending 文件被再次修改时，更新 currentContent 和 hunks，保持 pending 状态 |
| write 工具创建新文件时没有 originalContent | 新文件的 originalContent 为空字符串（""），Reject 时删除文件 |
| Agent abort 时待审查文件怎么处理 | 保留待审查状态不清空——用户仍可审查已生成的变更，agent abort 不应丢弃已写入的代码 |
| Session 切换时 DiffReviewManager 是否清理 | 调用 DiffReviewManager.clear() 清空所有状态——新 session 不应继承旧 session 的待审查文件 |
| 已 accepted/rejected 文件再次被 agent 修改 | 重置为 pending 状态，更新 originalContent 为上一次 accepted 时的内容（如果之前是 accepted）或保持原始快照（如果之前是 rejected 后又被 agent 重新修改） |
