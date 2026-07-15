## MODIFIED Requirements

### Requirement: TUI 主内容区渲染

系统 SHALL 在 App.tsx 主内容区根据 showDashboard 状态决定渲染 TeamDashboard、WelcomeBanner 或 MessageList。

#### Scenario: showDashboard 为 true 时渲染 TeamDashboard

- **WHEN** `showDashboard === true`
- **THEN** 系统 SHALL 在主内容区渲染 TeamDashboard 组件
- **AND** WelcomeBanner 和 MessageList SHALL 不渲染

#### Scenario: showDashboard 为 false 且 isWelcome 时渲染 WelcomeBanner

- **WHEN** `showDashboard === false` 且 `isWelcome === true`
- **THEN** 系统 SHALL 在主内容区渲染 WelcomeBanner 组件
- **AND** TeamDashboard 和 MessageList SHALL 不渲染

#### Scenario: showDashboard 为 false 且非 isWelcome 时渲染 MessageList

- **WHEN** `showDashboard === false` 且 `isWelcome === false`
- **THEN** 系统 SHALL 在主内容区渲染 MessageList 组件
- **AND** TeamDashboard 和 WelcomeBanner SHALL 不渲染

## ADDED Requirements

### Requirement: toggleDashboard 快捷键

系统 SHALL 在 normal mode 下支持 `\` 键切换 TeamDashboard 显示状态。

#### Scenario: \ 键 toggle dashboard

- **WHEN** 用户在 normal mode 下按 `\` 键
- **THEN** 系统 SHALL 切换 `showDashboard` 状态（true → false 或 false → true）

#### Scenario: showDashboard 默认值

- **WHEN** App 组件初始化
- **THEN** `showDashboard` 默认值 SHALL 为 `isWelcome && members.length > 0`
- **AND** 当 `isWelcome` 变为 false（用户开始对话）时，`showDashboard` SHALL 自动设为 false

#### Scenario: Escape/i 关闭 dashboard

- **WHEN** `showDashboard === true` 且用户按 Escape 或 i 键
- **THEN** 系统 SHALL 设置 `showDashboard = false`
- **AND** 如果当前 mode 为 normal，i 键 SHALL 同时切换到 insert mode
