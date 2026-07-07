## ADDED Requirements

### Requirement: QuestionBox 组件
系统 SHALL 提供 `QuestionBox` React 组件，在 question 工具激活时替换 InputBox 渲染于编辑框区域（底部 flexShrink=0 位置）。QuestionBox SHALL 使用与 InputBox 相同的圆角边框样式（borderStyle="rounded"），边框颜色为 `borderActive`。

#### Scenario: 条件渲染
- **WHEN** App 的 `pendingQuestion` state 非空
- **THEN** App SHALL 渲染 `<QuestionBox>` 替代 `<InputBox>`
- **AND** QuestionBox SHALL 显示当前问题的 `header`（短标签）和 `question`（完整描述）

#### Scenario: 选项导航
- **WHEN** QuestionBox 渲染选项列表
- **THEN** 系统 SHALL 使用 `↑`/`↓` 键在选项间移动选中项
- **AND** 当前选中项 SHALL 用 `▶` 标记

#### Scenario: 单选确认
- **WHEN** `multiple` 为 false 或未设置，用户按 Enter
- **THEN** 系统 SHALL 将当前选中项作为该问题的答案
- **AND** 若有后续问题，SHALL 切换到下一个问题；若为最后一个问题，SHALL 提交所有答案

#### Scenario: 多选确认
- **WHEN** `multiple` 为 true，用户按 Space
- **THEN** 系统 SHALL 切换当前选中项的勾选状态（`☑`/`☐`）
- **AND** 用户按 Enter SHALL 确认所有已勾选项作为该问题的答案

#### Scenario: 自定义输入
- **WHEN** 用户选中最后一个选项（"Type your own answer…"）或按特定快捷键
- **THEN** 系统 SHALL 进入自定义输入模式，使用 OpenTUI Textarea 接收用户输入
- **AND** 用户输入的文本 SHALL 作为该问题的自定义答案

#### Scenario: 多问题 Tab 导航
- **WHEN** question 工具包含多个问题
- **THEN** QuestionBox SHALL 一次只显示一个问题
- **AND** SHALL 在顶部显示进度指示（如 `Question 2/3`）
- **AND** Tab 键 SHALL 切换到下一个问题（仅当当前问题已回答）

#### Scenario: 回答提交
- **WHEN** 用户完成最后一个问题的回答并按 Enter
- **THEN** QuestionBox SHALL 调用 `bridge.resolve(answers)` 传入 `string[][]` 格式的全部答案
- **AND** App SHALL 清空 `pendingQuestion` state，恢复 InputBox 渲染

#### Scenario: Esc 取消
- **WHEN** 用户在 QuestionBox 中按 Escape
- **THEN** 系统 SHALL 调用 `bridge.resolve([])` 返回空答案数组（表示用户取消）
- **AND** App SHALL 清空 `pendingQuestion` state，恢复 InputBox 渲染

### Requirement: question 事件检测
系统 SHALL 在 `useSessionEvents` hook 中检测 `tool_execution_start` 事件中 `toolName === "question"` 的调用，通过回调通知 App 设置 `pendingQuestion` state。

#### Scenario: 检测 question 工具调用
- **WHEN** 收到 `tool_execution_start` 事件且 `toolName === "question"`
- **THEN** useSessionEvents SHALL 通过回调（如 `onQuestionAsked`）将 `event.args.questions` 传递给 App
- **AND** App SHALL 设置 `pendingQuestion` state 为传入的问题数据

#### Scenario: question 工具完成
- **WHEN** 收到 `tool_execution_end` 事件且对应工具为 question
- **THEN** App SHALL 确保 `pendingQuestion` 已被清空（QuestionBox 的 resolve 回调应先于此事件触发）
