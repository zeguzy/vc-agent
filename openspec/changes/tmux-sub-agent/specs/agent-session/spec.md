## ADDED Requirements

### Requirement: tmux_agent 工具双名单注册

系统 SHALL 将 `tmux_agent` 工具同时注册到 `customTools` 数组（工具定义）和 `tools` 白名单数组（注册门槛），参照 AGENTS.md 的双名单约定。注册 SHALL 覆盖三个位置：`createRuntime` factory（`src/agent/session.ts`）、`handleSetAgentMode`（`src/server/index.ts`）、以及 `STANDARD_ACTIVE_TOOLS` 和 `TEAM_ACTIVE_TOOLS` 常量定义。

#### Scenario: STANDARD_ACTIVE_TOOLS 包含 tmux_agent
- **WHEN** 查看 `STANDARD_ACTIVE_TOOLS` 常量
- **THEN** 数组 SHALL 包含 `"tmux_agent"`

#### Scenario: TEAM_ACTIVE_TOOLS 包含 tmux_agent
- **WHEN** 查看 `TEAM_ACTIVE_TOOLS` 常量
- **THEN** 数组 SHALL 包含 `"tmux_agent"`

#### Scenario: createRuntime factory 注入工具定义
- **WHEN** `createRuntime` factory 构建 customTools 数组
- **THEN** SHALL 调用 `createTmuxAgentTool({ subAgentService })` 并加入 customTools
- **AND** `tools` 白名单参数 SHALL 包含 `"tmux_agent"`

#### Scenario: handleSetAgentMode 重建白名单
- **WHEN** `handleSetAgentMode(mode)` 切换模式时调用 `setActiveToolsByName`
- **THEN** 传入的工具名数组 SHALL 包含 `"tmux_agent"`

#### Scenario: 工具对 Agent 可见
- **WHEN** Agent session 创建后查询可用工具列表
- **THEN** `tmux_agent` SHALL 出现在工具注册表中（非 inactive，而是完整可见）
