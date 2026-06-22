# tui-input Specification

## Purpose
TBD - created by archiving change mvp-tui-agent. Update Purpose after archive.
## Requirements
### Requirement: OpenTUI Input 组件集成
系统 SHALL 使用 OpenTUI 的 Input 组件（`@opentui/core` 的 InputRenderable 或 `@opentui/react` 的 Input 组件）处理用户输入，支持基础行编辑。

#### Scenario: 输入字符
- **WHEN** 用户按下可打印字符键
- **THEN** 字符追加到 Input 组件当前值末尾，显示更新

#### Scenario: 退格删除
- **WHEN** 用户按下退格键（Backspace）
- **THEN** Input 组件删除最后一个字符，光标左移

#### Scenario: 提交输入
- **WHEN** 用户按下 Enter 键
- **THEN** Input 组件的当前值作为消息提交，触发 `session.prompt(text)`，Input 清空

### Requirement: 输入禁用状态
系统 SHALL 在 Agent 运行期间（等待响应时）禁用输入框，防止用户重复提交。

#### Scenario: Agent 运行中禁用
- **WHEN** `isRunning` state 为 true（Agent 正在响应）
- **THEN** Input 组件显示为禁用态（灰色/不可聚焦），按 Enter 不触发提交

#### Scenario: Agent 完成后恢复
- **WHEN** 收到 `agent_end` 事件，`isRunning` 变为 false
- **THEN** Input 组件恢复为可用态，自动获取焦点

### Requirement: 输入历史记录
系统 SHALL 维护一个输入历史列表，用户通过上/下方向键浏览之前提交过的输入。

#### Scenario: 浏览上一条历史
- **WHEN** 用户按上方向键（↑）
- **THEN** Input 组件的值替换为历史列表中上一条记录

#### Scenario: 浏览下一条历史
- **WHEN** 用户按下方向键（↓）
- **THEN** Input 组件的值替换为历史列表中下一条记录，到达末尾时清空

#### Scenario: 历史不跨会话
- **WHEN** 程序重启
- **THEN** 历史记录从空开始（MVP 不持久化）

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

