## Context

openagent 的会话由 `@earendil-works/pi-coding-agent` SDK 的 `AgentSession` + `SessionManager` 管理，持久化为 `~/.config/openagent/sessions/` 下的 JSONL 文件。消息以**树**结构组织：每个 entry 有 `id` / `parentId`，"leaf" 指针标记当前位置。`SessionManager` 是 **append-only**——只允许 `append*` 追加和 `branch()` / `navigateTree()` 移动 leaf，不允许删除 entry。

SDK 暴露的关键原语（来自 `agent-session.d.ts`，已通过 librarian 核实）：

```typescript
class AgentSession {
  readonly sessionManager: SessionManager;          // L165, public
  get messages(): AgentMessage[];                    // L290, 只读 getter
  navigateTree(targetId: string, options?): Promise<{ editorText?: string; cancelled: boolean; }>;
  getUserMessagesForForking(): Array<{ entryId: string; text: string }>;
}
class SessionManager {
  getEntry(id: string): SessionEntry;                // entry.id / entry.parentId
  getEntries(): SessionEntry[];
}
```

`navigateTree(targetId)` 把 leaf 移到 `targetId`，`session.messages` getter 随即基于从新 leaf 回溯到 root 的路径重建给 LLM 的 context。这就是 pi `/tree` 命令的底层——"回退"在 pi 的设计哲学里就是"移动 leaf 指针产生新分支"，被抛弃的分支留在文件里，不删除。

当前 TUI 架构（`src/tui/`）：`App.tsx` 持有 `messages: Message[]` React state，通过 `useSessionEvents` 订阅 SDK 事件增量更新；命令经 `client.executeCommand(cmd, args, ctx)` 分发到 `commandRegistry`，`ctx: CommandContext` 是命令与 TUI 交互的唯一契约。`InputBox` 内部用 `TextareaRenderable`（`textareaRef.current.setText()`）控制文本，但未暴露给父组件。

## Goals / Non-Goals

**Goals:**
- `/undo` 撤销最近一轮（最后一条 user message + 其后 assistant 回复/工具调用），leaf 回到上一轮结束点
- 被撤销的最后一条 user message 原文自动回填输入框，用户可立即编辑重发
- 命令通过 `CommandContext` 契约与 TUI 交互，不破坏现有命令签名
- HTTP 模式优雅降级（提示不可用，不崩溃）

**Non-Goals:** 见 proposal.md。

## Decisions

### Decision 1: 用 `navigateTree(parentId)`，不用 `fork` / `createBranchedSession`

**选择**: 撤销时调 `session.navigateTree(lastUserMsg.parentId)`，在同一会话文件内移动 leaf。

**理由**:
- 与用户选择的"分支式保留"策略一致——零新文件、零 IO 开销、纯内存指针移动
- `navigateTree` 是 pi `/tree` 的同款 API，行为已被 SDK 充分测试
- `fork(entryId, {position:"before"})` 会产生新文件 + `switchSession`，多两步 IO 且触发 session 切换事件流，MVP 无此必要
- `createBranchedSession` + `switchSession` 是物理截断路径，违背 Non-goal

**目标节点为何是 `parentId` 而非 user message 自身**: `navigateTree(targetId)` 把 leaf 设为 `targetId`。若 navigate 到最后一条 user message 本身，那条 user message 仍在 active context 里（没被撤销）。要真正移出最后一轮，leaf 必须指向它的前驱——即该 user message 的 `parentId`（通常是上一轮的 assistant 回复）。

### Decision 2: 通过 `sessionManager.getEntry(id).parentId` 取前驱

**选择**: `AgentSession.sessionManager`（public readonly）→ `getEntry(lastUser.entryId).parentId`。

**理由**: `getUserMessagesForForking()` 只返回 `{entryId, text}`，不含 parentId。`sessionManager` 是 public 的，`getEntry` 是只读查询，无副作用。

**替代方案**: 自己遍历 `getEntries()` 找链路 → 多余，`getEntry(id)` 直接命中索引。

### Decision 3: 输入框回填用「pendingInput 对象 + nonce」而非受控 value

**选择**: App 持有 `pendingInput: { text: string; nonce: number } | null`，通过 prop 传给 InputBox；InputBox 用 `useEffect` 监听 `pendingInput?.nonce` 变化执行 `textareaRef.current.setText(text)`。

**理由**:
- InputBox 内部状态复杂（`currentText` / `historyIndex` / `savedDraft` / `inputHeight` / suggestions），改成完全受控会牵动全部交互逻辑，风险大
- nonce 保证"两次设置相同文本"也能触发（纯文本 prop 对相同值不会 re-render）
- 对象引用每次新建，语义清晰：null = 无待处理，非 null = 有待写入
- 写入后由 InputBox 自主管理后续状态（用户继续编辑、提交、清空都走原有路径）

**替代方案**:
- `forwardRef` + `useImperativeHandle` 暴露 `setText()` → imperative，与 React 数据流相悖，且 App 需持 ref
- 扩展 `sentMessages` 复用历史导航机制 → 语义混乱（历史导航是用户主动 ↑↓，undo 是命令主动注入）

### Decision 4: `/undo` 执行后手动 `setMessages(getMappedMessages())` 强制刷新

**选择**: `navigateTree` 成功后，命令 handler 显式调用 `ctx.setMessages(ctx.client.getMappedMessages())`。

**理由**: `navigateTree` 是否触发 SDK 事件让 `useSessionEvents` 自动刷新 TUI 消息列表，未在 SDK 文档中明确保证。手动刷新确保 TUI 立即反映新 leaf 的消息视图，不依赖事件行为。`getMappedMessages()` 内部调 `mapSdkMessagesToTui(session.messages)`，而 `session.messages` getter 会基于新 leaf 重建——数据源正确。

### Decision 5: 边界处理

| 情况 | 处理 |
|------|------|
| `getUserMessagesForForking()` 为空 | 追加 assistant 消息 "没有可撤销的对话。" |
| 最后一条 user message 的 `parentId` 为空（它是会话首条消息，即整个会话只有这一轮） | 追加提示 "已是会话开头，无法继续撤销。" |
| `isRunning === true`（agent 正在跑） | 追加提示 "Agent 正在运行，请先等待完成或 /abort。" 直接返回 |
| `client.getSession()` 抛 `NotSupportedError`（HTTP 模式） | catch 后追加提示 "/undo 仅在本地模式可用。" |
| `navigateTree` 返回 `cancelled: true` | 不回填输入框，追加提示 "已取消撤销。" |

### Decision 6: 不修改 keymap / 不加全局快捷键

**选择**: `/undo` 只走 slash command 分发，不绑定快捷键。

**理由**: 用户明确要求"目前只用实现 /undo 命令"。快捷键（如 Ctrl+U）留待未来。现有 `Ctrl+C` 是 abort，`u` 在 NORMAL 模式未占用但加全局键会扩大 blast radius。

## Data Flow

```
用户输入 /undo + Enter
        │
        ▼
App.handlePrompt("/undo")
        │  client.executeCommand("undo", "", ctx)
        ▼
commandRegistry → /undo handler
        │
        │  1. session = ctx.client.getSession()
        │  2. userMsgs = session.getUserMessagesForForking()
        │  3. lastUser = userMsgs[last]
        │  4. parentId = session.sessionManager.getEntry(lastUser.entryId).parentId
        │  5. await session.navigateTree(parentId)   // leaf 移到前驱
        │  6. ctx.setMessages(ctx.client.getMappedMessages())  // 强制刷新 TUI
        │  7. ctx.setInputText(lastUser.text)        // 回填输入框
        ▼
App: setPendingInput({text: lastUser.text, nonce: Date.now()})
        │  prop 传递
        ▼
InputBox: useEffect([pendingInput?.nonce])
        │  textareaRef.current.setText(text)
        │  textareaRef.current.gotoBufferEnd()
        │  setCurrentText(text); setInputHeight(...)
        ▼
用户看到：消息列表少了一轮 + 输入框已填入原文，光标在末尾，可直接编辑重发
```

```
会话文件（JSONL, append-only, 树结构）:

撤销前 leaf 链:  root → u1 → a1 → u2 → a2 → u3 → a3(leaf)
撤销后 leaf 链:  root → u1 → a1 → u2 → a2(leaf)
                                          ↘ (u3 → a3 仍在文件里，但不在 active path)
用户重发 u3'（可编辑）后:
                 root → u1 → a1 → u2 → a2 → u3' → a3'(新 leaf, 新分支)
                                          ↘ u3 → a3 (旧分支, /tree 可见)
```

## Risks / Trade-offs

- **[Risk] `navigateTree` 不触发 SDK 事件导致 TUI 不刷新** → Decision 4 手动 `setMessages(getMappedMessages())` 兜底；实施时需实测确认刷新即时
- **[Risk] `sessionManager.getEntry` 对未知 id 抛错** → `getUserMessagesForForking()` 返回的 entryId 来自 SDK 当前 session，必然存在；加 try/catch 防御
- **[Risk] `pendingInput` nonce 与 React 批处理冲突** → nonce 用 `Date.now()`，同一 tick 内多次调用会覆盖为最后一次（符合"最新胜出"语义）；若需严格队列化留待未来
- **[Risk] HTTP 模式用户困惑** → Non-goal 已声明，命令给出明确降级提示而非静默失败
- **[Trade-off] 被撤销的 turn 留在磁盘** → 用户已选择分支式保留；若后续要"彻底遗忘"，走 `createBranchedSession` 路径（本次 Non-goal）
- **[Trade-off] 输入框回填后历史导航状态可能错乱** → InputBox 的 useEffect 写入后应重置 `historyIndex = -1` / `savedDraft = null`，避免 ↑↓ 把回填内容当草稿
