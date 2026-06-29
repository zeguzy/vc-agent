## 1. App.tsx — 提取已发送消息列表

- [x] 1.1 在 `handlePrompt` 上方添加 `useMemo`，从 `messages` 中提取已发送用户消息文本（过滤 `role === "user" && !queued`），生成 `sentMessages: string[]`
- [x] 1.2 将 `sentMessages` 作为 prop 传递给 `<InputBox>`

## 2. InputBox.tsx — 历史导航状态与交互

- [x] 2.1 扩展 `InputBoxProps`，添加 `sentMessages: string[]` 属性
- [x] 2.2 添加 `historyIndex`（number，默认 -1）和 `savedDraft`（string | null，默认 null）state
- [x] 2.3 在 `handleKeyDown` 中，当 `!showSuggestions` 时处理 ↑ 键逻辑：
  - 若 `historyIndex === -1`：保存当前 `currentText` 到 `savedDraft`，设 `historyIndex = sentMessages.length - 1`，加载最后一条消息到 textarea
  - 若 `historyIndex > 0`：递减 `historyIndex`，加载对应消息
- [x] 2.4 在 `handleKeyDown` 中，当 `!showSuggestions` 时处理 ↓ 键逻辑：
  - 若 `historyIndex >= 0 && historyIndex < sentMessages.length - 1`：递增 `historyIndex`，加载对应消息
  - 若 `historyIndex === sentMessages.length - 1`：恢复到 `savedDraft ?? ""`，重置 `historyIndex = -1`、`savedDraft = null`
- [x] 2.5 在 `handleContentChange` 中，当 `historyIndex >= 0` 时重置 `historyIndex = -1`、`savedDraft = null`（手动编辑即退出浏览）

## 3. 验证

- [x] 3.1 运行 `bun run check`（typecheck + lint + test）确认无回归
- [ ] 3.2 手动验证：启动 TUI，发送几条消息后按 ↑↓ 测试历史导航
