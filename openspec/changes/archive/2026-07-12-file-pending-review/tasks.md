## 1. DiffReviewManager 核心

- [x] 1.1 创建 `src/diff-review/types.ts`：定义 `FileChangeStatus`（pending/accepted/rejected）、`FileChange`（filePath, originalContent, currentContent, status, hunks）、`DiffReviewEvent` 类型
- [x] 1.2 创建 `src/diff-review/manager.ts`：实现 `DiffReviewManager` 类，包含 `fileChanges: Map<string, FileChange>`、`recordChange(filePath, originalContent, newContent)`、`accept(filePath)`、`reject(filePath)`、`acceptAll()`、`rejectAll()`、`getPendingFiles()`、`getChange(filePath)`、`clear()`、EventEmitter 事件系统
- [x] 1.3 实现 `recordChange`：首次记录时保存 originalContent 快照，更新 currentContent 和 hunks（使用 generateUnifiedPatch），状态设为 pending
- [x] 1.4 实现 `accept`：标记状态为 accepted，保留磁盘内容，emit 事件
- [x] 1.5 实现 `reject`：恢复 originalContent 到磁盘（新文件则删除），标记状态为 rejected，emit 事件
- [x] 1.6 编写 `tests/diff-review-manager.test.ts`：覆盖 recordChange、accept、reject、acceptAll、rejectAll、多次修改同一文件、新文件 reject 删除

## 2. 集成到 edit/write 工具

- [x] 2.1 修改 `src/tools/edit.ts` 的 `createEditTool`：新增 `reviewManager?: DiffReviewManager` 参数，在 `operations.writeFile` 中写盘前调用 `reviewManager.recordChange()` 记录快照，写盘后通知更新
- [x] 2.2 修改 `src/agent/session.ts` 的 `createSession` 和 `createRuntime`：创建 DiffReviewManager 实例，传入 createEditTool
- [x] 2.3 修改 `src/teams/manager-v2.ts` 的 `buildMemberToolDefinitions`：传入 DiffReviewManager 实例到 createEditTool
- [x] 2.4 修改 `src/server/index.ts`：不需要直接修改（通过 session.ts 间接调用）

## 3. TUI PendingReviewBar 组件

- [x] 3.1 创建 `src/tui/components/PendingReviewBar.tsx`：显示 "N file(s) pending review" + 文件名列表（最多显示 3 个，超出显示 +N more），支持快捷键 A（Accept All）、R（Reject All）、Enter（打开 DiffReviewView）
- [x] 3.2 在 `src/tui/App.tsx` 中集成 PendingReviewBar：订阅 DiffReviewManager 事件更新 pending 状态，在 InputBox 上方条件渲染

## 4. TUI DiffReviewView 组件

- [x] 4.1 创建 `src/tui/components/DiffReviewView.tsx`：全屏 overlay，显示当前文件的 diff（使用 OpenTUI `<diff>` 组件），顶部显示文件名和索引（2/5），底部显示操作提示（n/p 导航、a 接受、r 拒绝、Esc 关闭）
- [x] 4.2 在 `src/tui/App.tsx` 中集成 DiffReviewView：新增 showReviewView 状态，通过 PendingReviewBar 的 Enter 或快捷键 Ctrl+R 打开
- [x] 4.3 实现键盘导航：n/p 切换文件、a 接受当前文件、r 拒绝当前文件（恢复原始内容）、Esc 关闭视图、最后一个文件处理后自动关闭

## 5. Client 层桥接

- [x] 5.1 修改 `src/client/types.ts`：AgentClient 接口新增 `getDiffReviewManager()` 方法
- [x] 5.2 修改 `src/client/in-process.ts`：InProcessAgentClient 实现 getDiffReviewManager
- [x] 5.3 修改 `src/client/http.ts`：HttpClient 实现 getDiffReviewManager（返回 null，远程模式不支持审查）
- [x] 5.4 修改 `src/server/http.ts`：HttpAgentServer 暴露 DiffReviewManager 给 client

## 6. 收尾验证

- [x] 6.1 运行 `bun run check` 确保 typecheck + lint + test 全部通过
- [x] 6.2 手动启动 TUI（`bun run dev`），验证 agent 修改文件后 PendingReviewBar 出现，Accept/Reject 功能正常，Reject 后文件内容恢复
