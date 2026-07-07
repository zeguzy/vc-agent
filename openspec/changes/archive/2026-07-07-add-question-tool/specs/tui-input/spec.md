## ADDED Requirements

### Requirement: question 工具激活时替换 InputBox
系统 SHALL 在 question 工具执行期间（`pendingQuestion` state 非空时），用 QuestionBox 组件替换 InputBox 组件渲染于编辑框区域。替换期间 InputBox 的所有功能（文本编辑、slash command、消息队列、模式切换）SHALL 暂停。

#### Scenario: pendingQuestion 时渲染 QuestionBox
- **WHEN** `pendingQuestion` state 非空
- **THEN** App SHALL 在 InputBox 的渲染位置渲染 `<QuestionBox>` 而非 `<InputBox>`
- **AND** QuestionBox SHALL 占据与 InputBox 相同的布局位置（底部 flexShrink=0）

#### Scenario: pendingQuestion 清空后恢复 InputBox
- **WHEN** `pendingQuestion` 被设置为 null（用户已回答或取消）
- **THEN** App SHALL 恢复渲染 `<InputBox>`
- **AND** InputBox SHALL 恢复到 question 之前的状态（保留草稿文本、模式等）

#### Scenario: question 期间键盘事件隔离
- **WHEN** QuestionBox 渲染中
- **THEN** useKeyboard 全局键盘处理 SHALL 不响应 INSERT/NORMAL 模式切换和消息列表滚动键
- **AND** 所有键盘事件 SHALL 由 QuestionBox 内部处理
