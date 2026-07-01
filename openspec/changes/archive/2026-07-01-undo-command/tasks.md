## 1. 扩展 CommandContext 契约

- [x]1.1 `src/commands/registry.ts`：`CommandContext` 接口新增两个字段（类型安全，无 `any`）：
  - `setInputText: (text: string) => void` —— 命令向输入框注入文本
  - `isRunning: boolean` —— 当前 agent 是否正在运行（只读快照，供 `/undo` 前置校验，避免破坏 agent 循环）
- [x]1.2 确认无其它实现 `CommandContext` 的地方需要同步（grep 确认仅 `App.tsx` 的 `buildCommandCtx` 构造）

## 2. App.tsx — pendingInput state 与命令上下文注入

- [x]2.1 新增 state `const [pendingInput, setPendingInput] = useState<{ text: string; nonce: number } | null>(null)`
- [x]2.2 `buildCommandCtx` 返回对象增加两项：
  - `setInputText: (text: string) => setPendingInput({ text, nonce: Date.now() })`
  - `isRunning: isRunningRef.current`（复用已有 ref，避免 useCallback 依赖频繁变化）
- [x]2.3 `<InputBox>` 调用处增加 `pendingInput={pendingInput}` prop

## 3. InputBox.tsx — 接收外部 pendingInput 并写入 textarea

- [x]3.1 `InputBoxProps` 新增 `pendingInput?: { text: string; nonce: number } | null`
- [x]3.2 新增 `useEffect(() => { ... }, [pendingInput?.nonce])`：当 nonce 变化时，调 `textareaRef.current?.setText(pendingInput.text)` + `gotoBufferEnd()`，并同步 `setCurrentText` / `setInputHeight`（按 `pendingInput.text.split("\n").length` 计算高度，clamp 2~6）
- [x]3.3 该 useEffect 内同时重置 `setHistoryIndex(-1)` + `setSavedDraft(null)`，避免历史导航状态污染回填内容

## 4. 注册 /undo 命令

- [x]4.1 `src/tui/commands.ts` 的 `registerBuiltinCommands` 内注册 `/undo` 命令：
  - `name: "undo"`、`description: "Undo the last conversation turn"`、`usage: "/undo"`
  - handler 逻辑（按 design.md Decision 5 边界处理，顺序即检查顺序）：
    1. 若 `ctx.isRunning === true`（agent 正在跑）→ 提示 "Agent 正在运行，请先等待完成或 /abort。" 直接返回
    2. try 取 `session = ctx.client.getSession()`；若抛 `NotSupportedError`（HTTP 模式）→ catch 提示 "/undo 仅在本地模式可用。" 返回
    3. `userMsgs = session.getUserMessagesForForking()`；空数组 → 提示 "没有可撤销的对话。" 返回
    4. `lastUser = userMsgs[userMsgs.length - 1]`；`parentId = session.sessionManager.getEntry(lastUser.entryId)?.parentId`
    5. `parentId` 为空 → 提示 "已是会话开头，无法继续撤销。" 返回
    6. `await session.navigateTree(parentId)`；若返回 `cancelled` → 提示 "已取消撤销。" 返回
    7. `ctx.setMessages(ctx.client.getMappedMessages())` 强制刷新
    8. `ctx.setInputText(lastUser.text)` 回填输入框
- [x]4.2 整个 handler 用 try/catch 包裹，异常时 `ctx.setMessages(prev => [...prev, createAssistantMessage(\`撤销失败: ${formatError(err)}\`)])`

## 5. /help 与自动补全

- [x]5.1 确认 `/help` 自动包含 `/undo`（`buildHelpText` 遍历 `commandRegistry.getAll()`，注册后自动出现，无需改代码）—— 仅需验证
- [x]5.2 确认 slash 建议列表自动包含 `/undo`（`matchSuggestions` 走 `commandRegistry.match`，同理自动）—— 仅需验证

## 6. 验证

- [x]6.1 运行 `bun run check`（typecheck + lint + test）确认全绿
- [ ] 6.2 手动验证：启动 TUI，发 2~3 轮对话后执行 `/undo`，确认：消息列表回退一轮、输入框填入被撤销的用户消息原文、再次发送产生新分支、连续多次 `/undo` 逐轮回退、首条消息时 `/undo` 给出边界提示、agent 运行中 `/undo` 被拒绝
