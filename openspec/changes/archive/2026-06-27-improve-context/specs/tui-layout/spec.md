## MODIFIED Requirements

### Requirement: 底部状态栏职责
系统 SHALL 将最底部状态栏限制为模式指示、模型信息和上下文用量展示。

#### Scenario: 状态栏显示模式与模型
- **WHEN** 应用渲染底部状态栏
- **THEN** 状态栏 SHALL 显示当前模式（`-- INSERT --` 或 `-- NORMAL --`，颜色：insert=success绿、normal=primary蓝）、模型名称（从 `session.model?.name` 获取），右侧显示上下文用量指示器

#### Scenario: 上下文用量指示器
- **WHEN** 状态栏渲染上下文用量
- **THEN** compact 模式 SHALL 显示 `◌ N%`，full 模式 SHALL 显示 `◌ tokens/window (N%)`，通过 `/context` 命令切换
- **AND** 颜色 SHALL 按用量变化：<50% success绿、50-80% warning黄、>80% error红

#### Scenario: 上下文用量数据来源
- **WHEN** 状态栏需要显示上下文用量
- **THEN** 数据 SHALL 来自 `useSessionEvents` hook 维护的 `contextUsage` state（`{ tokens, window, percent }`）
- **AND** `contextUsage` SHALL 在 `agent_start`、`tool_execution_end`、`agent_end` 事件触发时刷新
- **AND** session 热切换后（`setRebindSession` 回调）SHALL 立即初始化 `contextUsage`
