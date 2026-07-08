## ADDED Requirements

### Requirement: Subagent 工具消息卡片
系统 SHALL 为 `subagent` 工具调用渲染专用的 `SubagentMessageView` 组件（而非通用 `ToolMessageView`），展示 agent 名、执行模式、状态、流式进度和结构化结果。

#### Scenario: MessageList 分发 subagent 工具
- **WHEN** MessageList 渲染 `role === "tool"` 且 `toolName === "subagent"` 的消息
- **THEN** 系统 SHALL 使用 `SubagentMessageView` 渲染，不经过 `ToolMessageView`
- **AND** `SubagentMessageView` SHALL 被 `React.memo` 包装

#### Scenario: 标题行内容
- **WHEN** 渲染 `SubagentMessageView` 标题行
- **THEN** 标题行 SHALL 显示：状态图标 + agent 名（取自 `subagentDetails.results[0].agent`，缺失时回退到 `toolArgs.agent`）+ 模式标记（parallel/chain 时显示，single 省略）+ 任务描述（取自 `toolArgs.description` 或首个 task 的 description）
- **AND** 多任务（parallel/chain）时 SHALL 显示任务总数（如 `· 3 tasks`）

#### Scenario: running 状态显示流式尾部
- **WHEN** `toolStatus === "running"`
- **THEN** 系统 SHALL 从 `toolResult`（即 `partialResult`）的 `{content:[{type:"text",text}]}` 结构提取文本
- **AND** SHALL 只显示最近 8 行（`textMuted` 色），不累积全文
- **AND** 若 `partialResult` 为空或结构不符，SHALL 显示占位文本 `running…`

#### Scenario: done 状态结构化展示结果
- **WHEN** `toolStatus === "done"` 且 `subagentDetails` 存在
- **THEN** 系统 SHALL 遍历 `subagentDetails.results[]`，每个 result 渲染为：
  - agent 名（`secondary` 色）+ 任务描述
  - output 预览（截断显示，`textMuted` 色）
  - usage 摘要：`{inputTokens+outputTokens} tok · ${cost} · {turns} turns`（`textSubtle` 色）
- **AND** 若 `result.error` 非空，SHALL 以 `error` 色显示错误
- **AND** 底部 SHALL 显示总计：`Total: {sum} tok · ${totalCost} · {totalTurns} turns`

#### Scenario: 降级为通用工具卡片
- **WHEN** `toolName === "subagent"` 但 `subagentDetails` 不存在（如 session 恢复后）
- **THEN** 系统 SHALL 降级为从 `toolResult` 提取文本（复用 `formatToolResult`），以通用工具卡片样式渲染

#### Scenario: 状态图标与边框颜色
- **WHEN** 渲染 `SubagentMessageView`
- **THEN** 状态图标 SHALL 为 `⠹`（running）/ `✓`（done, `success` 色）/ `✗`（error, `error` 色），与 `ToolMessageView` 一致
- **AND** 边框颜色 SHALL 为 `borderActive`（running）/ `borderSoft`（done）/ `error`（error），与 `ToolMessageView` 一致

### Requirement: Message 模型 subagentDetails 扩展
系统 SHALL 在 `Message` interface（`src/message.ts`）新增可选字段 `subagentDetails`，承载 `SubagentToolDetails` 结构化数据，供 `SubagentMessageView` 强类型消费。

#### Scenario: 字段定义
- **WHEN** 定义 `Message` interface
- **THEN** SHALL 包含 `subagentDetails?: SubagentToolDetails`（类型来自 `src/agents/types.ts`）
- **AND** 该字段 SHALL 仅在 subagent 工具的 `tool_execution_end` 时填充，其他工具消息保持 `undefined`
