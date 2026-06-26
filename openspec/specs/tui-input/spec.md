# tui-input Specification

## Purpose
定义底部输入区的编辑、提交、禁用和状态提示行为。

## Requirements
### Requirement: OpenTUI Textarea 组件集成
系统 SHALL 使用 OpenTUI 的 Textarea 组件（`@opentui/core` 的 `TextareaRenderable` 或 `@opentui/react` 的 `textarea` 组件）处理用户输入，支持多行草稿编辑。

#### Scenario: 输入字符
- **WHEN** 用户按下可打印字符键
- **THEN** 字符追加到 Textarea 当前内容，显示更新

#### Scenario: 退格删除
- **WHEN** 用户按下退格键（Backspace）
- **THEN** Textarea 删除光标前的字符，光标左移

#### Scenario: 多行草稿高度增长
- **WHEN** 用户通过换行创建多行草稿
- **THEN** 输入区高度 SHALL 随行数增长，并限制在 2 到 6 行之间

#### Scenario: 提交输入
- **WHEN** 用户按下 Enter 键
- **THEN** Textarea 当前内容 SHALL 作为消息提交，触发 `session.prompt(text)`，然后清空输入区

#### Scenario: 插入换行
- **WHEN** 用户按下 Shift+Enter
- **THEN** Textarea SHALL 插入换行，不提交消息

#### Scenario: 备用提交快捷键
- **WHEN** 用户按下 Ctrl+Enter 或 Meta+Enter
- **THEN** Textarea 当前内容 SHALL 作为消息提交

### Requirement: 输入区状态提示
系统 SHALL 在输入框上方显示一行轻量状态提示，使用英文文案，并避免在底部状态栏重复显示运行状态。

#### Scenario: 空闲状态提示
- **WHEN** Agent 空闲且输入可用
- **THEN** 状态行 SHALL 显示静态 `Ready`，并显示 `Enter to send · Shift+Enter for newline`

#### Scenario: 运行状态提示
- **WHEN** Agent 正在响应或执行工具
- **THEN** 状态行 SHALL 显示动态 spinner 和 `Working` 省略号动画，并显示 `Ctrl+C to stop`

#### Scenario: 输入框视觉稳定
- **WHEN** Agent 正在运行且状态行播放动画
- **THEN** 输入框边框 SHALL 保持稳定，不进行闪烁或脉冲动画

### Requirement: 输入禁用状态
系统 SHALL 在 Agent 运行期间（等待响应时）禁用输入框，防止用户重复提交。

#### Scenario: Agent 运行中禁用
- **WHEN** `isRunning` state 为 true（Agent 正在响应）
- **THEN** Textarea 显示为禁用态（灰色/不可聚焦），按 Enter 不触发提交

#### Scenario: Agent 完成后恢复
- **WHEN** 收到 `agent_end` 事件，`isRunning` 变为 false
- **THEN** Textarea 恢复为可用态，自动获取焦点

### Requirement: 中断处理
系统 SHALL 通过 OpenTUI 的键盘事件处理器监听 Ctrl+C，在不同状态下产生不同行为。

#### Scenario: Agent 运行中中断
- **WHEN** Agent 正在生成响应（`isRunning` 为 true）时用户按下 Ctrl+C
- **THEN** 调用 `AbortController.abort()` 中断当前 Agent 循环，停止流式输出，恢复输入框

#### Scenario: 空闲时退出
- **WHEN** Agent 空闲（`isRunning` 为 false）时用户按下 Ctrl+C
- **THEN** 退出 alternate screen，终止程序

#### Scenario: 连续两次 Ctrl+C 强制退出
- **WHEN** 用户在 1 秒内连续按两次 Ctrl+C
- **THEN** 立即调用 `process.exit(0)` 强制退出
