## Context

当前 InputBox 组件通过 `@opentui/core` 的 `TextareaRenderable` 处理输入，↑↓ 键仅在 slash command 建议列表可见时用于导航建议项。App 组件通过 React `useState` 持有 `messages: Message[]` 作为会话历史。

本次变更在**同一个组件内**为 INSERT 模式增加历史消息导航，不引入新依赖、不改变组件层级。

## Goals / Non-Goals

**Goals:**
- INSERT 模式下，非 slash command 时，↑ 显示上一条已发送消息，↓ 显示下一条
- 浏览历史时保存当前草稿，退出浏览后恢复
- 用户手动编辑内容时自动退出历史浏览模式

**Non-Goals:**
- 不跨会话持久化（仅内存中的 `messages` 数组）
- 不支持 Ctrl+R 反向搜索
- 不在 NORMAL 模式生效（NORMAL 已绑定 j/k 滚动）

## Decisions

### Decision 1: 状态放在 InputBox 内部，通过 props 接收历史数据

**选择**: App 计算 `sentMessages: string[]` 并传给 InputBox。InputBox 内部管理 `historyIndex` / `savedDraft`。

**理由**: 
- InputBox 是唯一消费历史导航的组件，自管理状态降低 App 复杂度
- `handleContentChange` 中重置状态不涉及父组件通信
- `sentMessages` 是派生数据，App 用 `useMemo` 即可高效计算

**替代方案**: 在 App 中管理 historyIndex → 需要额外 callback props，增加耦合度。

### Decision 2: 历史索引直接对应 `sentMessages` 数组下标

```
historyIndex = -1       → 不在浏览模式
historyIndex = n-1      → 最新消息（sentMessages 尾部）
historyIndex = 0        → 最早消息（sentMessages 头部）
↑ 键: historyIndex → max(0, historyIndex - 1)
↓ 键: historyIndex → min(n-1, historyIndex + 1) 或恢复草稿退出
```

**理由**: 直观，无需反转数组，边界判断简单。

### Decision 3: 手动编辑即退出浏览

`handleContentChange` 中重置 `historyIndex = -1`、`savedDraft = null`。

**理由**: 与 bash/fish readline 行为一致——一旦开始键入新内容，历史指针失效。

### Decision 4: 不修改 keymap.ts

**理由**: ↑↓ 键是 InputBox 内部的 `onKeyDown` 处理，不走全局 `useKeyboard`。keymap 目前仅管理 vim-like 模式键位。

## Data Flow

```
App.tsx                              InputBox.tsx
─────────                            ────────────
messages: Message[] ──useMemo──→    sentMessages: string[]
                                    historyIndex: number
                                    savedDraft: string | null

handlePrompt(text)                   ┌─ ↑: save draft → load history[i-1]
  ├─ createUserMessage(text)         │  ↓: load history[i+1] or restore draft
  └─ setMessages([...prev, msg])     └─ any key: reset historyIndex = -1
```

## Risks / Trade-offs

- **[Risk] 消息量大时 `sentMessages` 数组膨胀** → 非目标：单会话消息通常 < 200 条，无需分页
- **[Risk] queued 消息被错误纳入历史** → 过滤条件 `role === "user" && !queued` 排除排队中消息
