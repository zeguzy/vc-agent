## ADDED Requirements

### Requirement: SubAgentPanel 组件

系统 SHALL 在 `src/tui/components/SubAgentPanel.tsx` 新增 `SubAgentPanel` React 组件，展示所有 sub-agent session 的状态。组件 SHALL 从 `AgentClient` 获取 sub-agent 列表，渲染为列表项，每项显示 `name` / `type` / `status` / `lastOutput`（截断到 1 行）。组件 SHALL 在 `App.tsx` 根布局中作为可切换的覆盖层渲染（类似 `showWorkers` / `showSettings` 模式），通过 `showSubAgents` 状态控制显隐。

#### Scenario: 面板显示
- **WHEN** `showSubAgents` 状态为 `true`
- **THEN** SHALL 渲染 `SubAgentPanel` 覆盖层
- **AND** 列出所有 `SubAgentSession`，每项含 name / type / status 指示符 / lastOutput 摘要

#### Scenario: 空列表
- **WHEN** 无 sub-agent session
- **THEN** SHALL 显示提示文本 "No sub-agents. Use the tmux_agent tool to create one."

#### Scenario: status 视觉区分
- **WHEN** 渲染 sub-agent 列表项
- **THEN** status 为 "running" 时 SHALL 显示绿色指示符
- **AND** status 为 "completed" 时 SHALL 显示默认色
- **AND** status 为 "error" 时 SHALL 显示红色指示符
- **AND** status 为 "cancelled" 时 SHALL 显示灰色指示符

### Requirement: sub-agent 切换快捷键

系统 SHALL 在 `src/tui/keymap.ts` 新增快捷键绑定，在 normal 模式下通过特定按键切换显示 SubAgentPanel。系统 SHALL 在 `App.tsx` 的 `useKeyboard` 回调中处理该按键，通过 `setShowSubAgents(v => !v)` 切换显隐。新增 `showSubAgentsRef` ref 同步状态，确保 `useKeyboard` 闭包通过 ref 读取实时值（参照 AGENTS.md 的 ref 模式约定）。

#### Scenario: 切换面板显隐
- **WHEN** 处于 normal 模式
- **AND** 按下 sub-agent 切换键（如 `\` 已被 dashboard 占用，选用其他未占用键）
- **THEN** SHALL 调用 `setShowSubAgents(v => !v)` 切换面板显隐

#### Scenario: 面板打开时只响应 ctrlC
- **WHEN** `showSubAgents` 为 `true`
- **AND** 按下非 Ctrl+C / Escape 键
- **THEN** SHALL 忽略该按键（参照 `showSettings` / `showSessionPicker` 的拦截模式）

#### Scenario: 闭包安全
- **WHEN** `useKeyboard` 回调注册后，`showSubAgents` 状态发生变化
- **THEN** 回调内 SHALL 通过 `showSubAgentsRef.current` 读取实时值，而非闭包捕获的初始值
