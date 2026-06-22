## ADDED Requirements

### Requirement: 消息列表滚动渲染
系统 SHALL 使用 OpenTUI 的 ScrollBox 组件渲染消息列表，支持内容超出可视区域时自动滚动到最新消息。

#### Scenario: 新消息自动滚动
- **WHEN** Agent 产生新的流式文本或工具调用消息，且消息列表超出可视区域
- **THEN** ScrollBox 自动滚动到底部，显示最新内容

#### Scenario: 手动滚动浏览历史
- **WHEN** 用户在消息区使用鼠标滚轮或 Page Up/Down 键
- **THEN** ScrollBox 向上/向下滚动历史消息，不触发新的 prompt 提交

### Requirement: 用户消息渲染
系统 SHALL 以可区分的样式渲染用户发送的消息，与 Agent 消息形成视觉对比。

#### Scenario: 用户消息样式
- **WHEN** 渲染用户提交的输入消息
- **THEN** 显示绿色 `> ` 前缀，后跟消息内容，独占一行

### Requirement: Agent 流式文本渲染
系统 SHALL 将 Agent 的回复以流式方式逐字渲染到消息列表中，每条回复作为一个独立的文本块。

#### Scenario: 流式文本追加
- **WHEN** 收到 Agent 的 `message_update` 事件（text_delta）
- **THEN** 将增量文本追加到当前 Agent 消息块的末尾，OpenTUI 差分渲染只更新变化部分

#### Scenario: 新 Agent 消息开始
- **WHEN** Agent 开始新一轮回复（收到 `message_start` 事件）
- **THEN** 在消息列表中创建新的 Agent 消息块

### Requirement: 工具调用状态行
系统 SHALL 在 Agent 执行工具调用时显示工具状态信息行，包括工具名称和参数摘要。

#### Scenario: 工具调用开始显示
- **WHEN** Agent 开始执行工具（如 read、bash、edit）
- **THEN** 在消息列表中插入一行：`🔧 <toolName>(<参数摘要>)`，参数截断到 60 字符

#### Scenario: 工具调用完成更新
- **WHEN** 工具执行完成
- **THEN** 更新该行为 `✅ <toolName>` 或 `❌ <toolName>(<错误摘要>)`，表示成功或失败

### Requirement: 代码块语法高亮
系统 SHALL 使用 OpenTUI 的 Code 组件渲染代码块（Agent 回复中用三反引号标记的代码段），通过 tree-sitter 实现语法高亮。

#### Scenario: 代码块识别与渲染
- **WHEN** Agent 回复文本包含三反引号标记的代码块（如 `` ```ts\nconst x = 1\n`` ``）
- **THEN** 该代码段使用 OpenTUI Code 组件渲染，tree-sitter 按语言标记（ts/py/json 等）进行语法着色

#### Scenario: 行内代码
- **WHEN** Agent 回复文本包含单反引号包裹的行内代码（如 `` `variable` ``）
- **THEN** 行内代码以不同前景色渲染（如黄色），不触发完整代码块渲染

### Requirement: 轮次分隔线
系统 SHALL 在每轮 Agent 响应结束后在消息列表中输出分隔线，区分不同对话轮次。

#### Scenario: 分隔线渲染
- **WHEN** 收到 `agent_end` 事件
- **THEN** 在消息列表底部追加一条淡色分隔线（如 `─` 重复填满宽度）
