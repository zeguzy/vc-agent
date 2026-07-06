## Context

当前 team 模式中，成员信息仅通过 WorkersView 弹出面板查看，该面板只展示元数据（name/role/status），不展示成员的完整对话内容。用户在 normal 模式下缺少快捷键在成员子会话间快速跳转。输入区也缺少成员状态的"at a glance"信息。

目标：把成员标签和子会话切换整合进主 UI 流——标签行作为输入区的一部分，`[` / `]` 在成员间切换，MessageList 自动显示当前选中成员的对话。

## Goals / Non-Goals

**Goals:**
- 在输入框下方新增紧凑的成员标签行，实时显示所有成员名 + 运行时状态图标
- 支持 normal 模式 `[` / `]` 快捷键在成员间切换（含 leader）
- 切换成员时 MessageList 显示该成员的子会话消息
- 成员视图中输入的文字发送给该成员（`directMember("directive", ...)`）
- 切换回 leader 时恢复 orchestrator 默认视图

**Non-Goals:**
- 不改变 WorkersView 行为
- 不在成员视图中支持创建/删除成员
- 不做成员消息的实时流式订阅（V1 切换时重新加载）
- 不改变 HTTP client 端（仅 in-process 模式支持）

## Decisions

### 1. 状态模型：activeMemberName

App.tsx 新增 `activeMemberName: string | null` 状态。`null` 表示 leader/orchestrator 视图（当前行为），非 null 表示聚焦某个成员子会话。

```
┌──────────────────────────────────────────────────────┐
│                  App.tsx                              │
│                                                      │
│  activeMemberName ────────┬───────┐                   │
│      │                    │       │                   │
│      ▼                    ▼       ▼                   │
│  MessageList          InputBox  KeyHandler            │
│  (过滤消息源)         (标签行)  ([ / ] dispatch)      │
└──────────────────────────────────────────────────────┘
```

**替代方案考虑**：用独立的 `view` 枚举（类似 `showWorkers`/`showSettings`）。否决——成员子会话视图和 leader 视图共用 MessageList，只是消息源不同，不需要独立 view。

### 2. 消息派生策略

当 `activeMemberName` 不为 null 时，App.tsx 通过 `useMemo` 从 `client.getMember(activeMemberName).session.messages` 派生消息列表，调用 `mapSdkMessagesToTui()` 转换：

```typescript
const displayMessages = useMemo(() => {
  if (!activeMemberName) return messages; // 主会话
  const member = client.getMember(activeMemberName);
  if (!member) return [];
  return mapSdkMessagesToTui(member.session.messages);
}, [activeMemberName, messages, /* member update trigger */]);
```

切换时重新计算，成本低（`mapSdkMessagesToTui` 是纯同步函数）。

**替代方案考虑**：在 `MemberState` 中暴露预计算的 TUI 消息。否决——增加接口复杂度，且成员消息频繁变化（流式），缓存过期问题复杂。

### 3. 标签行组件层级

`MemberTags` 作为独立组件，渲染在 InputBox 的最底部（状态行之下、border box 之下）。InputBox 通过 props 接收成员列表：

```
┌──────────────────────────────────────────┐
│  🤝 team  model-name  📂 path:branch     │  ← 状态行
│  ┌────────────────────────────────────┐  │
│  │ ▶ Message openagent…              │  │  ← Textarea
│  └────────────────────────────────────┘  │
│  ▶ leader (○) · sasha (◌) · kim (✓)     │  ← MemberTags (NEW)
└──────────────────────────────────────────┘
```

通过 `showMemberTags` prop 控制可见性（仅 team 模式）。

**替代方案考虑**：在 App.tsx 层渲染标签行（类似 WorkersView）。否决——标签行语义上是输入区的一部分，应和 InputBox 一起管理。

### 4. 快捷键绑定

在 `keymap.ts` 新增：

```typescript
{ mode: "normal", key: { name: "[" }, action: "prevMember", desc: "Previous team member" },
{ mode: "normal", key: { name: "]" }, action: "nextMember", desc: "Next team member" },
```

这两个键在当前的 normal 模式 keymap 中没有绑定，`[` 和 `]` 作为成对方便记忆（"方向=成员列表方向"）。

### 5. 输入路由

在 `activeMemberName` 非 null 时，`handlePrompt` 将消息通过 `client.directMember(activeMemberName, "directive", text)` 发送给对应成员，而非 `client.prompt()` 或 `client.followUp()`。

```
handlePrompt(text):
  if activeMemberName is set:
    client.directMember(activeMemberName, "directive", text)
  else if isRunning:
    client.followUp(text)
  else:
    client.prompt(text)
```

## Risks / Trade-offs

- **[切换时消息不同步]** 成员在后台工作，切换到其视图时可能已产生新消息——V1 的"切换时重新加载"意味着用户看到的是快照，不是实时流。→ 切换到成员视图时自动重新加载；后续 V2 可订阅成员 session 事件实现实时更新。
- **[成员被删除]** 当前聚焦的成员可能在后台被删除。→ 每次渲染前检查 `client.getMember(name)`，若返回 undefined，自动切回 leader 并推一条 toast。
- **[成员会话为空]** 新建的成员还没有任何消息。→ 显示占位提示 "No messages yet. `memberName` is working..."。

## Open Questions

- 无——所有设计决策已在探索阶段确认。
