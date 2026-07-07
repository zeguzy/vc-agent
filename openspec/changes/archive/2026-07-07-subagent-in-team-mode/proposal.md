---
id: subagent-in-team-mode
status: proposed
created: 2026-07-07
---

# Proposal: Team 模式下启用 Subagent 工具

## 背景

当前 `team` 模式下 subagent 工具被完全屏蔽，导致用户无法在 team 模式中使用同步式 subagent 委派。这是由于三处互斥逻辑：

1. **`TEAM_ACTIVE_TOOLS`** 白名单不含 `"subagent"`
2. **`createRuntime` factory** 中 `isTeamMode` 分支不注册 `createSubagentTool`
3. **`appendSystemPromptFor("team")`** 不注入 available agents 列表

## 问题

Team 模式和 subagent 并非互斥关系：
- `team()` 适合异步并行委派（创建持久团队成员）
- `subagent()` 适合同步一次性任务（快速查询、单文件修改等轻量操作）
- 两者互补，不应二选一

## 方案

在 team 模式下同时注册 `subagent` 工具和 `team` 工具，让 agent 根据任务特性自行选择委派方式。

## Non-goals

- 不改变 team 模式下 team 工具的优先级或行为
- 不修改 subagent 工具本身的逻辑
- 不在 team member 内部递归开放 subagent（防止无限嵌套）
