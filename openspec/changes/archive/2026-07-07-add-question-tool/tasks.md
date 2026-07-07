## 1. Bridge 层（基础设施）

- [x] 1.1 创建 `src/tools/question-bridge.ts`：定义 `QuestionData` 类型（questions 数组）、`QuestionBridge` 接口（pending、resolve、reject 字段）、`createQuestionBridge()` 工厂函数
- [x] 1.2 为 bridge 添加清理方法（clear pending + reject promise），用于 session 热切换和中断场景

## 2. 工具层

- [x] 2.1 创建 `src/tools/question.ts`：使用 TypeBox 定义 question 工具的 parameters schema（questions 数组：question、header≤30、options[{label,description}]、multiple?）
- [x] 2.2 实现 `createQuestionTool(bridge)` 工厂函数：execute() 中设置 bridge.pending + 创建 Promise + 注册 AbortSignal 监听；bridge 为 undefined 时返回错误结果（非交互模式降级）
- [x] 2.3 实现工具返回值格式：AgentToolResult { content: [{type:'text', text: 摘要}], details: { answers: string[][] } }

## 3. Session 注册

- [x] 3.1 修改 `src/agent/session.ts`：`createRuntime` 签名新增 `bridge?` 参数，传入 runtime factory；factory 内 `customTools` 数组追加 `createQuestionTool(bridge)`
- [x] 3.2 修改 `createSession`（legacy）同样接收 bridge 参数并注册 question 工具
- [x] 3.3 在 rebind 回调路径中添加 bridge 清理逻辑（热切换时 reject 未完成 Promise）

## 4. TUI 层 — QuestionBox 组件

- [x] 4.1 创建 `src/tui/components/QuestionBox.tsx`：基础布局（圆角边框 + header + question 文本 + 选项列表），复用 InputBox 的样式变量（borderActive、backgroundInset、borderStyle="rounded"）
- [x] 4.2 实现键盘导航：↑/↓ 移动选中项（▶ 标记）、Space 多选切换（☑/☐）、Enter 确认
- [x] 4.3 实现自定义输入模式：选中最后一项或按快捷键进入 Textarea 输入，Enter 提交自定义文本
- [x] 4.4 实现多问题 Tab 导航：顶部进度指示（Question X/N）、逐个展示、Tab 切换（仅当前已回答时）、最后一问 Enter 提交全部
- [x] 4.5 实现 Esc 取消：调用 bridge.resolve([]) 返回空答案
- [x] 4.6 实现提交逻辑：收集所有答案为 string[][]，调用 bridge.resolve(answers)

## 5. TUI 层 — App 集成

- [x] 5.1 修改 `src/tui/App.tsx`：新增 `pendingQuestion` state（QuestionData | null）和 `bridge` prop
- [x] 5.2 修改 `src/tui/hooks/useSessionEvents.ts`：检测 `tool_execution_start` 中 `toolName === "question"`，通过回调（onQuestionAsked）将 args.questions 传递给 App
- [x] 5.3 修改 App 渲染逻辑：pendingQuestion 非空时渲染 `<QuestionBox>` 替代 `<InputBox>`，清空后恢复
- [x] 5.4 修改 `useKeyboard` 全局键盘处理：pendingQuestion 期间跳过 INSERT/NORMAL 模式切换和滚动键，交由 QuestionBox 处理

## 6. 入口接线

- [x] 6.1 修改 `index.tsx`：在 `runTui()` 中 `createRuntime()` 之前调用 `createQuestionBridge()`，传递给 `createRuntime({..., bridge})` 和 `<App bridge={bridge} />`
- [x] 6.2 确认 headless（run）和 serve 模式不创建 bridge（传 undefined），question 工具自动降级

## 7. 验证

- [x] 7.1 `bun run check`（typecheck + lint + test）全部通过
- [ ] 7.2 手动测试：Agent 调用 question 工具 → QuestionBox 在编辑框区域渲染 → ↑↓ 导航 → Enter 确认 → 答案返回 Agent
- [ ] 7.3 手动测试：多问题 Tab 导航、多选 Space 勾选、自定义输入、Esc 取消
- [ ] 7.4 手动测试：Ctrl+C 中断 Agent 时 question 工具正确 reject
