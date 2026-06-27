## MODIFIED Requirements

### Requirement: Agent 流式文本渲染

系统 SHALL 将 Agent 的回复以流式方式渲染到消息列表中。流式缓冲逻辑 SHALL 封装在 `useStreamingBuffer` Hook（位于 `tui/hooks/useStreamingBuffer.ts`）中，通过 80ms `setTimeout` 节流后批量 `setMessages` 更新。

#### Scenario: 流式文本追加（节流）

- **WHEN** 收到 `message_update` 事件
- **THEN** 增量文本 SHALL 由 `useStreamingBuffer` Hook 管理，存入 pending ref，通过 80ms 节流后批量更新
- **AND** Hook 暴露 `flush()` 方法供 `message_end` 事件立即刷新

#### Scenario: 消息完成立即刷新

- **WHEN** 收到 `message_end` 事件
- **THEN** 系统 SHALL 清除节流定时器，立即写入最终文本和思考内容

### Requirement: Agent 回复与思考内容分离

系统 SHALL 将 Agent 回复中的 `type:text` 和 `type:thinking` 内容分别提取和渲染。内容提取函数 SHALL 从 `utils/content.ts`（原来内联在 `agent/session.ts`）导入。

#### Scenario: 思考内容提取

- **WHEN** 收到 Agent 消息
- **THEN** 系统 SHALL 通过 `extractAssistantContent(content)`（从 `utils/content.ts` 导入）返回 `{text, thinking}`，分别存储到 Message 的 `content` 和 `thinking` 字段

### Requirement: 消息列表核心数据模型

系统 SHALL 在 `src/message.ts`（原 `src/store.ts`）中定义 Message 接口和工厂函数（`createUserMessage`、`createAssistantMessage`、`createToolMessage`、`createSeparator`）。所有引用该模块的导入路径 SHALL 更新为 `../message.js`。

### Requirement: TUI 工具模块组织

系统 SHALL 将 TUI 工具文件按关注点组织到子目录中：
- `tui/hooks/`：自定义 React Hook（`useSessionEvents`、`useStreamingBuffer`、`useSessionPicker`）
- `tui/utils/`：纯工具函数（`clipboard`、`selection`、`streaming`、`syntax`、`theme`）
- `tui/components/`：React 组件（保持不变）
- `tui/` 根目录：`App.tsx`、`keymap.ts`、`commands.ts`

#### Scenario: 工具文件导入

- **WHEN** App.tsx 或其他组件引用工具函数
- **THEN** 导入路径 SHALL 使用新的子目录路径（如 `./utils/theme.js`、`../utils/theme.js`）
- **AND** 所有引用在新路径下 SHALL 正常工作
