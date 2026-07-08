## 1. 数据层

- [x] 1.1 `src/message.ts`：Message interface 新增 `subagentDetails?: SubagentToolDetails` 字段（类型从 `src/agents/types.ts` 导入），并导出该类型重导出以便组件消费
- [x] 1.2 `src/tools/subagent.ts`：execute 返回的 `content` 改为 XML 包裹格式（`<subagent-result agent status mode><output>...</output></subagent-result>`），output 截断阈值从 50000 改为 5000 字符（超出附 truncation 提示）；工具 `description` 末尾补充"The result returned by the subagent is not visible to the user. To show the user the result, send a text message summarizing it."

## 2. 事件层

- [x] 2.1 `src/tui/hooks/useSessionEvents.ts`：switch 新增 `case "tool_execution_update"` —— 通过 `event.toolCallId` 找到 message id，`setMessages` 更新该 message 的 `toolResult = event.partialResult`（不改 toolStatus）；`tool_execution_end` 分支增加：若 `event.toolName === "subagent"` 且 `event.result.details` 存在，同时写入 `message.subagentDetails`

## 3. 渲染层

- [x] 3.1 新建 `src/tui/components/SubagentMessageView.tsx`：`memo` 包装的组件，渲染标题行（状态图标 + agent 名 + 模式标记 + 任务描述）、running 时显示 `toolResult`(partialResult) 最近 8 行、done 时遍历 `subagentDetails.results[]` 结构化展示（agent/description/output 预览/usage 摘要）+ 总计行；`subagentDetails` 缺失时降级为 `formatToolResult` 通用渲染；状态图标/边框颜色复用 ToolMessageView 同款配色
- [x] 3.2 `src/tui/components/MessageList.tsx`：`groupMessages` 后的分发逻辑增加分支 —— `msg.role === "tool" && msg.toolName === "subagent"` 时渲染 `<SubagentMessageView>`，其余 tool 消息维持原逻辑

## 4. 验证

- [x] 4.1 运行 `bun run check`（typecheck + lint + test）确认全绿，修复引入的任何类型/测试失败
