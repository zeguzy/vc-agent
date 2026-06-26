# tui-messages Specification

## Purpose
定义消息列表的渲染规则，包括用户消息气泡、Agent 回复（含思考内容）、工具调用卡片、read 合并、流式更新和轮次分隔。

## Requirements

### Requirement: 消息列表滚动渲染
系统 SHALL 使用 OpenTUI 的 ScrollBox 组件渲染消息列表（`stickyScroll` + `stickyStart="bottom"`），支持内容超出可视区域时自动滚动到最新消息。

#### Scenario: 新消息自动滚动
- **WHEN** Agent 产生新的流式文本或工具调用消息，且消息列表超出可视区域
- **THEN** ScrollBox 自动滚动到底部，显示最新内容

#### Scenario: NORMAL 模式手动滚动
- **WHEN** 用户在 NORMAL 模式下按 j/k/g/G
- **THEN** ScrollBox 按对应方向滚动（j=向下2行, k=向上2行, g=顶部, G=底部）

### Requirement: 用户消息圆角气泡
系统 SHALL 以圆角边框卡片样式渲染用户发送的消息，与 Agent 消息形成视觉对比。

#### Scenario: 用户消息样式
- **WHEN** 渲染用户提交的输入消息
- **THEN** 消息 SHALL 使用 `borderStyle="rounded"` 四边圆角边框，`borderColor=borderSoft`，`backgroundColor=backgroundPanel`，paddingTop/Bottom=1，paddingLeft/Right=2
- **AND** 外层 box 只包含边框，内层嵌套 box 包含背景色和 padding

### Requirement: Agent 回复与思考内容分离
系统 SHALL 将 Agent 回复中的 `type:text` 和 `type:thinking` 内容分别提取和渲染。

#### Scenario: 思考内容提取
- **WHEN** 收到 Agent 消息（`message_start`/`message_update`/`message_end`）
- **THEN** 系统 SHALL 通过 `extractAssistantContent(content)` 返回 `{text, thinking}`，分别存储到 Message 的 `content` 和 `thinking` 字段

#### Scenario: 思考内容渲染（展开）
- **WHEN** 渲染 Agent 回复且 `thinkingCollapsed` 为 false
- **THEN** 思考内容 SHALL 显示为：橙色（`warning`）`- Thinking` 标签 + 灰色（`textSubtle`）思考正文（按行分割），与下方 markdown 正文之间有 marginTop=1 间距

#### Scenario: 思考内容渲染（折叠）
- **WHEN** 渲染 Agent 回复且 `thinkingCollapsed` 为 true
- **THEN** 思考内容 SHALL 显示为：橙色 `+ Thinking …` 标签，不展示正文

#### Scenario: 无思考内容
- **WHEN** Agent 回复不包含 thinking 块
- **THEN** 不渲染 Thinking 标签和内容

### Requirement: Agent 流式文本渲染
系统 SHALL 将 Agent 的回复以流式方式渲染到消息列表中，使用节流（120ms）避免渲染抖动。

#### Scenario: 流式文本追加（节流）
- **WHEN** 收到 `message_update` 事件
- **THEN** 增量文本 SHALL 存入 `pendingTextRef` 和 `pendingThinkingRef`，通过 120ms `setTimeout` 节流后批量 `setMessages` 更新

#### Scenario: 消息完成立即刷新
- **WHEN** 收到 `message_end` 事件
- **THEN** 系统 SHALL 清除节流定时器，立即 `setMessages` 写入最终文本和思考内容

#### Scenario: 新 Agent 消息开始
- **WHEN** 收到 `message_start` 事件
- **THEN** 在消息列表中创建新的 Agent 消息块，通过 `extractAssistantContent` 提取初始文本和思考内容

### Requirement: React.memo 性能优化
系统 SHALL 对非流式组件使用 `React.memo` 包装，避免不必要的重渲染。

#### Scenario: 非流式组件 memo 化
- **WHEN** 消息列表重渲染（如流式更新）
- **THEN** `UserMessageView`、`ToolMessageView`、`ReadGroupView`、`SeparatorView` SHALL 被 `memo()` 跳过重渲染，仅 `AssistantMessageView` 重渲染

### Requirement: 工具调用卡片
系统 SHALL 以圆角边框卡片样式渲染工具调用，按工具类型显示不同的详情和结果。

#### Scenario: 工具卡片样式
- **WHEN** 渲染工具调用消息
- **THEN** 消息 SHALL 使用 `borderStyle="rounded"` 四边圆角边框，`backgroundColor=backgroundInset`，顶部行显示状态图标 + 工具名（`secondary` 色），下方显示详情行

#### Scenario: 状态图标与边框颜色
- **WHEN** 工具执行中/完成/失败
- **THEN** 图标 SHALL 为 spinner `⠹`（running）/ `✓`（done, `success` 色）/ `✗`（error, `error` 色），边框颜色 SHALL 为 `borderActive`（running）/ `borderSoft`（done）/ `error`（error）

#### Scenario: 按工具类型显示详情
- **WHEN** 渲染工具详情行
- **THEN** read 工具 SHALL 显示 `path` + 可选行范围（offset+limit→`path:offset-(offset+limit-1)`，offset only→`path:offset+`）
- **AND** bash 工具 SHALL 显示 `command`（截断 80 字符）
- **AND** edit 工具 SHALL 显示 `path` + diff 行（`-` 红色旧文本 / `+` 绿色新文本）
- **AND** write 工具 SHALL 显示 `path` + 行数

#### Scenario: 工具结果显示
- **WHEN** 工具执行完成（status=done/error）
- **THEN** 系统 SHALL 通过 `formatToolResult` 从 Pi SDK 结构 `{content:[{type:'text',text}]}` 提取文本，显示最多 15 行
- **AND** read 工具 SHALL 跳过结果显示
- **AND** 错误结果 SHALL 使用 `error` 色

### Requirement: 连续 Read 调用合并
系统 SHALL 将连续的 read 工具调用消息合并为一个卡片，每行代表一次 read 调用。

#### Scenario: 合并渲染
- **WHEN** 消息列表中存在连续的 read 工具消息（≥2 条相邻）
- **THEN** 系统 SHALL 将其合并为 `ReadGroupView` 卡片，每行显示 `[N] path:range`，使用 `textSubtle` 色

#### Scenario: 单条 read 不合并
- **WHEN** 只有一条 read 工具消息（非连续）
- **THEN** 系统 SHALL 使用标准 `ToolMessageView` 卡片渲染

### Requirement: 轮次分隔线
系统 SHALL 在每轮 Agent 响应结束后在消息列表中输出分隔线。

#### Scenario: 分隔线渲染
- **WHEN** 收到 `agent_end` 事件
- **THEN** 在消息列表底部追加一条 `SeparatorView`（顶部边框线 `─`），并更新上下文用量（`session.getContextUsage()`）

### Requirement: 代码块语法高亮
系统 SHALL 使用 OpenTUI 的 markdown 组件渲染 Agent 回复，通过 tree-sitter 实现语法高亮。

#### Scenario: markdown 渲染
- **WHEN** Agent 回复包含 markdown 格式（代码块、行内代码、标题、列表等）
- **THEN** markdown 组件 SHALL 按 `syntaxStyle` 和 `theme.ts` 中的颜色渲染，支持 `streaming=true` 流式模式

### Requirement: 排队消息指示器
系统 SHALL 在 InputBox 上方渲染排队消息的独立指示器，不混入消息流。

#### Scenario: 排队消息渲染
- **WHEN** 消息列表中存在 `queued: true` 的消息
- **THEN** 系统 SHALL 从 MessageList 中过滤排队消息，在 InputBox 上方渲染独立的圆角指示器：`Queued →` 标签（`secondary` 色）+ 消息内容（`textMuted` 色）
