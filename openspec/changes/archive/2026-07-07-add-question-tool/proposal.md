## Why

Agent 经常需要在执行过程中向用户提问以澄清意图、确认方案或获取决策。当前 openagent 没有结构化的交互提问能力，Agent 只能通过生成文本消息隐式提问，用户通过 follow-up 消息回答，缺乏结构化和可操作性。参考 opencode 的 question 工具设计，在编辑框区域渲染交互式 Q&A UI，使 Agent 能以结构化方式获取用户输入。

## What Changes

- 新增 `question` 工具：Agent 可调用该工具向用户展示结构化问题（支持多问题、多选、自定义输入）
- 新增 QuestionBridge：连接 Agent 工具层与 React TUI 层的桥接机制，使工具的异步执行能等待用户交互
- 新增 QuestionBox 组件：在编辑框区域（InputBox 位置）渲染交互式选项 UI，支持 ↑/↓ 导航、Enter 确认、Space 多选、自定义输入
- 修改 agent-session：在 `customTools` 中注册 `question` 工具
- 修改 tui-input：当 question 工具激活时，临时用 QuestionBox 替换 InputBox
- 修改 index.tsx 入口：创建 QuestionBridge 并传递给 runtime 和 App

## Capabilities

### New Capabilities

- `question-tool`: Agent 工具层——定义 `question` 工具的参数 schema、执行逻辑（通过 bridge 异步等待用户回答）、返回值格式
- `question-bridge`: 桥接层——连接 Agent 工具 execute() 与 React TUI 的可变对象，支持 pending question 设置、Promise resolve 回调
- `tui-question-box`: TUI 层——QuestionBox 组件的渲染、键盘交互、状态管理，以及在 App 中的条件渲染逻辑

### Modified Capabilities

- `agent-session`: 在 `customTools` 中新增 `createQuestionTool(bridge)`，createRuntime 和 createSession 均需注册
- `tui-input`: 当 question 工具执行时，InputBox 被 QuestionBox 临时替换

## Impact

- **新增文件**：`src/tools/question.ts`、`src/tools/question-bridge.ts`、`src/tui/components/QuestionBox.tsx`
- **修改文件**：`src/agent/session.ts`（注册工具 + 接收 bridge 参数）、`src/tui/App.tsx`（pendingQuestion 状态 + 条件渲染）、`index.tsx`（创建 bridge + 传递）
- **依赖**：无新增外部依赖，复用 TypeBox schema 和 @opentui/react 组件
- **非交互模式**：headless（`run`）和 HTTP（`serve`）模式下 question 工具 SHALL 返回错误，不阻塞执行

## Non-goals

- 不实现 pi-coding-agent 的 `ctx.ui.custom()` 渲染（openagent 使用独立 React TUI，不兼容 pi 的 string[] 渲染系统）
- 不实现 `/ask` 用户命令（那是 user→agent 方向，与 agent→user 的 question 工具无关）
- 不实现语音/语音输入等其他交互方式
- 不在消息列表区域渲染 question 历史（question 交互过程不持久化到消息流，仅返回结构化结果摘要）
