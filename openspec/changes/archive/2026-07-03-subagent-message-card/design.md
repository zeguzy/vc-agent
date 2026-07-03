## Context

subagent 工具（`src/tools/subagent.ts`）是核心的子代理委派能力，支持 single / parallel / chain 三种模式。当前其 TUI 消息卡片几乎空白，根因有三：

1. **流式更新丢失**：Pi SDK 在工具执行期间发出 `tool_execution_update` 事件（带 `partialResult`），但 `useSessionEvents`（`src/tui/hooks/useSessionEvents.ts`）只处理 `tool_execution_start` / `tool_execution_end`，完全忽略 `tool_execution_update`。
2. **结构化数据浪费**：`subagent.ts` 返回 `{content, details}` 双通道 —— `content` 喂 LLM，`details: SubagentToolDetails`（agent 名 / output / usage / cost / turns）给 TUI。但 TUI 的 `formatToolResult` 只读 `content` 的 markdown 文本，`details` 被丢弃。
3. **标题无信息**：`formatToolDetail`（`MessageList.tsx:104`）的 switch 无 `case "subagent"`，走 default 只显示裸字符串 `"subagent"`。

**参考模型**（通过双 librarian 调研确认）：
- **opencode**（`sst/opencode`，`@opentui/solid`）：subagent = `task` 工具调用。两个渲染界面 —— 内联卡片（加载时不渲染，完成时显示 markdown 结果）+ footer inspector（实时活动流）。LLM 收到 `<task id state><task_result>` XML，不含 usage。
- **oh-my-pi**（`can1357/oh-my-pi`）：厚 `details` 通道 —— `TaskToolDetails` 聚合 `SingleResult[]` + usage + progress。LLM 收到 `<task-result id agent status duration><preview>` XML，preview 截断 5000 字 + `agent://<id>` 指针。

## Goals / Non-Goals

**Goals:**
- 让 subagent 执行中的流式输出可见（解决"执行中空白"）
- 让 subagent 完成后的结果结构化展示（解决"完成后一坨文本"）
- 让 subagent 卡片标题显示 agent 名 + 模式 + 任务描述（解决"标题无信息"）
- 父 LLM 的 tool_result 更结构化、更省 token（XML 包裹 + 截断 + 指针）

**Non-Goals:**
- 不实现 footer inspector / 实时活动面板（本项目无此架构）
- 不实现后台异步任务 / `progress[]` 嵌套进度（subagent 是同步阻塞的）
- 不改 `runner.ts` 的隔离执行模型
- 不改 session 恢复（`mapSdkMessagesToTui`）对 subagent 的回放
- 不引入动画 spinner（沿用现有静态字符模式，与 ToolMessageView 视觉一致）

## Decisions

### 决策 1：走 oh-my-pi 厚 details 路线，不走 opencode 薄通道

**选择**：在 `tool_execution_end` 时把 `event.result.details` 完整存进 `message.subagentDetails`，TUI 直接消费。

**理由**：opencode 的薄通道（只给 `sessionId` 指针，TUI 自己下钻子会话）依赖 footer inspector 架构。本项目 TUI 是独立 React 层，无下钻能力，details 必须在事件里一次性带齐。oh-my-pi 路线省一次往返，更适合本架构。

**备选**（否决）：只渲染 `content` 的 markdown —— 无法区分 parallel 多任务、无法显示 cost/turns、无法结构化。

### 决策 2：content 改为 XML 包裹 + status + 5000 字截断 + 指针

**选择**：`subagent.ts` 返回的 `content` 从裸 markdown 改为：

```
<subagent-result agent="..." status="completed|failed" mode="single|parallel|chain">
<output>
{preview 截断到 5000 字}
</output>
</subagent-result>
```

**理由**：
- XML 包裹给 LLM 明确结构边界（opencode `<task>` + oh-my-pi `<task-result>` 共识），减少误读为用户可见内容。
- 5000 字截断（oh-my-pi 验证的安全线）避免长输出灌爆父上下文。现状是 50000 字，风险高。
- 显式 `status` 让父 LLM 判断成败，决定是否重试。

**备选**（否决）：opencode 的"不截断全量"—— 在本项目 TUI 通道尚薄的情况下风险更高。

> **注**：全量指针 `agent://<id>` 需要 session 树存储子会话能力，本项目当前不具备。MVP 先不做指针，截断即终态；如未来需要可在 `details.output` 保留全量、TUI 可展开查看。

### 决策 3：Message 模型新增 `subagentDetails` 字段

**选择**：`src/message.ts` 的 `Message` interface 新增可选字段 `subagentDetails?: SubagentToolDetails`。

**理由**：`toolResult` 是 `unknown`，直接塞 details 会丢失类型。独立字段让 `SubagentMessageView` 强类型消费，且不影响其他工具的 `toolResult` 用法。

```
interface Message {
  ...existing...
  subagentDetails?: SubagentToolDetails;  // 新增：仅 subagent 工具填充
}
```

### 决策 4：running 时显示流式尾部，不显示历史

**选择**：`SubagentMessageView` 在 `toolStatus === "running"` 时，从 `toolResult`（即 `partialResult`）提取文本，只显示**最近 N 行**（N=8），不累积全文。

**理由**：TUI 渲染性能 + 可读性。opencode 的做法是 running 时内联完全不渲染（走 footer），但本项目没有 footer，内联必须显示点什么。最近几行既能传达进度又不刷屏。

### 数据流架构（ASCII）

```
┌─────────────────────────────────────────────────────────────────┐
│ 子代理执行 (src/agents/runner.ts)                               │
│   独立 AgentSession，订阅 message_end                           │
│   ├─ 累计 usage (input/output/cache/cost/turns)                 │
│   └─ lastText + onUpdate(text) ──────────┐                      │
└──────────────────────────────────────────┼──────────────────────┘
                                           │
┌──────────────────────────────────────────▼──────────────────────┐
│ subagent.ts execute()                                           │
│   ├─ onUpdate → Pi SDK: tool_execution_update {partialResult}   │
│   └─ return {                                                  │
│        content: "<subagent-result ...>XML</subagent-result>",   │
│        details: SubagentToolDetails {mode, results[], cost}     │
│      }                                                          │
└──────────────────┬──────────────────────────────────────────────┘
                   │
         ┌─────────▼──────────┐
         │  Pi SDK 事件流     │
         └──┬───────┬───────┬─┘
            │       │       │
   start ───┘  update┘    end┘
            │       │       │
            ▼       ▼       ▼
┌─────────────────────────────────────────────────────────────────┐
│ useSessionEvents (src/tui/hooks/useSessionEvents.ts)            │
│                                                                 │
│  start:  createToolMessage("subagent", args, "running")         │
│  update: msg.toolResult = event.partialResult  ◄── 新增 case    │
│  end:    msg.toolStatus = done/error                            │
│          msg.toolResult = event.result                         │
│          msg.subagentDetails = event.result.details ◄── 新增    │
└───────────────────┬─────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────────┐
│ MessageList 分发 (src/tui/components/MessageList.tsx)           │
│                                                                 │
│  msg.role==="tool" && msg.toolName==="subagent"                 │
│    → <SubagentMessageView message={msg} />  ◄── 新增分支        │
│  else → 现有 ToolMessageView / TodoMessageView / ...            │
└───────────────────┬─────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────────┐
│ SubagentMessageView (新组件)                                    │
│                                                                 │
│  ┌─ 标题行 ─────────────────────────────────────────────────┐   │
│  │ ◔/✓/✗  explore · parallel        Build Agent             │   │
│  │        (状态) (agent名) (模式徽章)  (任务描述)            │   │
│  └──────────────────────────────────────────────────────────┘   │
│  running: 显示 partialResult 最近 8 行 (textMuted)              │
│  done:                                                          │
│    ┌─ results[] 结构化 ─────────────────────────────────────┐   │
│    │ ▸ explore  "Find auth patterns"                        │   │
│    │   {output 截断预览}                                     │   │
│    │   1.2k tok · $0.003 · 3 turns                          │   │
│    ├────────────────────────────────────────────────────────┤   │
│    │ ▸ refactor "Extract AuthService"                       │   │
│    │   ...                                                   │   │
│    └────────────────────────────────────────────────────────┘   │
│    Total: 3.4k tok · $0.008 · 7 turns                           │
└─────────────────────────────────────────────────────────────────┘
```

## Risks / Trade-offs

- **[流式更新频率]** runner.ts 的 `onUpdate` 每次 assistant message_end 才触发（非逐 token），频率不高 → 无需节流，直接 setMessages。若未来 runner 改为逐 token 流式，需加节流（参考 AssistantMessageView 的 120ms）。
- **[partialResult 结构不稳定]** Pi SDK 的 `partialResult` 是 `any`，subagent.ts 传的是 `{content:[{type:"text",text}], details}`。需在 SubagentMessageView 做类型 narrowing，降级为空数组而非崩溃。
- **[content 格式变化影响 LLM]** 父 LLM 收到的 tool_result 从 markdown 改 XML，可能短暂影响已适应旧格式的会话。→ 可接受，XML 是两个参考项目的共识，方向正确。
- **[parallel/chain 多结果的卡片高度]** 多任务时卡片可能很高。→ MVP 不折叠，全展示；如体验差可后续加折叠（参考 thinkingCollapsed 模式）。
- **[session 恢复不回放 subagent details]** `mapSdkMessagesToTui` 只从历史 SDK messages 重建，subagent 的 details 不在持久化消息里 → 恢复后卡片退化为普通工具摘要（已有 `createToolMessage(name,args,"done")`）。属于 Non-goal，单独 follow-up。
