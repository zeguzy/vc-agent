## Why

subagent 工具（`src/tools/subagent.ts`）是核心的子代理委派能力，但其 TUI 消息卡片当前几乎空白，用户既看不到执行进度也看不懂最终结果：

1. **执行中无进度**：`useSessionEvents`（`src/tui/hooks/useSessionEvents.ts`）未处理 Pi SDK 的 `tool_execution_update` 事件，子代理的流式输出被完全丢弃 —— 几十秒到几分钟的执行期间卡片内容区一片空白。
2. **完成后无结构**：`subagent.ts` 返回的 `details: SubagentToolDetails`（含每个子代理的 agent 名 / output / usage / cost / turns）未被 TUI 消费，只把一坨 markdown 纯文本塞进 `formatToolResult`，并行多任务的输出被揉成一团。
3. **标题信息缺失**：`formatToolDetail`（`src/tui/components/MessageList.tsx`）没有 `case "subagent"`，标题只显示裸字符串 `"subagent"`，看不出调用了哪个 agent、什么模式（single/parallel/chain）。

根因已通过对照两个成熟实现确认：opencode（`sst/opencode`，`@opentui/solid` TUI）和 oh-my-pi（`can1357/oh-my-pi`，pi-mono fork）。本次对齐 opencode 的渲染模型 + oh-my-pi 的厚 `details` 数据通道。

## What Changes

- **事件层**：`useSessionEvents` 新增 `tool_execution_update` 分支，把 `partialResult` 写进对应 tool message，让子代理执行中的流式输出可见。
- **数据层**：`Message` 模型新增 `subagentDetails?` 字段承载 `SubagentToolDetails`；`tool_execution_end` 时把 `event.result.details` 写入。`subagent.ts` 的 `content` 改为 XML 包裹（`<subagent-result>`）+ 显式 status + 输出截断到 5000 字 + 全量指针（`agent://<id>` 风格）。
- **渲染层**：新建 `SubagentMessageView` 组件 —— 标题行（agent 名 + 模式徽章 + 状态 spinner/icon）、running 时显示流式输出尾部、done 时结构化展示每个子代理结果 + cost/turns 统计。`MessageList` 分发处 `toolName === "subagent"` 走新组件。
- **工具描述**：subagent 工具 `description` 补充「结果对用户不可见，需转述」（对齐 opencode `task.txt` 第 3 条），减少父代理原样转发。

## Capabilities

### New Capabilities

（无 —— 本次是对现有消息渲染与事件流能力的扩展）

### Modified Capabilities

- `tui-messages`: 新增 subagent 工具消息的专门渲染规则（`SubagentMessageView`），以及 `Message` 模型的 `subagentDetails` 扩展
- `agent-session`: 新增 `tool_execution_update` 事件处理；subagent 工具 `content` 格式改为 XML 包裹 + status + 指针

## Impact

- **代码**：
  - 修改：`src/tui/hooks/useSessionEvents.ts`、`src/tui/components/MessageList.tsx`、`src/message.ts`、`src/tools/subagent.ts`
  - 新建：`src/tui/components/SubagentMessageView.tsx`
- **依赖**：无新增（`@opentui/react` 已有 `box`/`text` 原语；spinner 需确认，若无则用静态字符）
- **LLM 行为**：subagent 的 tool_result 从裸 markdown 改为 XML 包裹 + 截断（5000 字），父代理消费的内容更结构化、更省 token；不影响现有工具的渲染

## Non-goals

- **不**实现 opencode 的 footer inspector（实时子代理活动面板）—— 本项目无 footer 多 tab 架构，内联卡片 + 流式进度已足够
- **不**实现 oh-my-pi 的后台异步任务（background job）/ `progress[]` 嵌套子代理实时进度 —— 当前 subagent 是同步阻塞执行
- **不**修改子代理的隔离执行模型（`src/agents/runner.ts` 的独立 AgentSession）—— 只改结果呈现，不改执行
- **不**增加会话树下钻 / 子会话浏览能力
- **不**改其他工具（read/bash/edit/grep 等）的渲染
- **不**改 session 恢复（`mapSdkMessagesToTui`）对 subagent 的回放 —— 单独 follow-up
