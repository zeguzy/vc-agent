## Why

当前 vc-agent 的 subagent 交互体验与 opencode/oh-my-openagent 存在显著差距：subagent 工具参数格式不对齐（缺少 category/subagent_type/load_skills/run_in_background/task_id）、session 临时性无法续接、无异步模式、结果格式是 XML 而非 Markdown+metadata、team member 工具集是受限子集而非"与主代理同能力"。用户希望对齐 opencode 的 subagent 交互体验，使子代理具备与主代理同等的独立能力和可观测性。

## What Changes

- **扩展 `subagent` 工具参数**：对齐 oh-my-openagent 的 `DelegateTaskArgs` 格式，新增 description、prompt、category、subagent_type、run_in_background、task_id、command、load_skills 参数（向后兼容）
- **新增异步模式**：`run_in_background=true` 时创建独立 AgentSession 并立即返回 bg_xxx ID，子 session 完成时复用已有的 `member_done` → steer 通知机制
- **新增 task_id 续接**：支持复用已有 subagent session（ses_... 格式），通过 `session.followUp()` 续接
- **统一结果格式**：从 XML `<subagent-result>` 改为 Markdown + `<task_metadata>` 块，对齐 oh-my-openagent 的 `buildSyncTaskCompletion`
- **改进 UI 展示**：改进 SubagentMessageView 渲染（更紧凑、信息密度更高），不新增组件
- **视角切换扩展**：复用已有 `[`/`]` 键 + `activeMemberName` 机制，扩展支持 subagent 子 session
- **TeamMember 工具集完整继承**：member session 完整继承主 session 的工具集，仅排除递归/特权工具（subagent/team/question）

## Capabilities

### New Capabilities
- `subagent-async-mode`: subagent 异步执行模式，复用已有的 member_done → steer 通知机制，新增 TaskRegistry + background_output/background_cancel 工具
- `subagent-delegate-args`: subagent 工具参数对齐 DelegateTaskArgs，新增 category/subagent_type/run_in_background/task_id/command/load_skills

### Modified Capabilities
- `tui-messages`: 改进 SubagentMessageView 渲染，结果格式统一为 Markdown + `<task_metadata>`
- `member-sub-session-view`: 视角切换扩展支持 subagent 子 session（复用 `[`/`]` 键 + activeMemberName 机制）
- `team-orchestration`: TeamManager.createMember 工具集从受限白名单改为完整继承主 session 工具集（仅排除 subagent/team/question）
- `subagent-model-config`: subagent 工具支持 task_id 续接已有 session

## Impact

- **核心文件变更**：`src/tools/subagent.ts`（参数扩展）、`src/agents/runner.ts`（异步模式+续接+结果格式）、`src/teams/manager-v2.ts`（工具集继承重构）、`src/tui/components/SubagentMessageView.tsx`（渲染改进）、`src/tui/App.tsx`（视角切换扩展）
- **API 变更**：subagent 工具新增 optional 参数（向后兼容），新增 background_output/background_cancel 工具
- **消息格式变更**：subagent 结果从 XML 改为 Markdown + `<task_metadata>`
- **依赖影响**：无新增外部依赖
- **向后兼容**：所有改动向后兼容，无 breaking change

## Non-goals

- 不新增 `task` 工具（扩展现有 `subagent` 工具）
- 不新增 SubtaskPartView 渲染组件（改进现有 SubagentMessageView）
- 不实现 oh-my-openagent 的 category→model 路由
- 不实现 tmux 子代理
- 不实现 oh-my-openagent 的 team-mode
- 不实现 oh-my-openagent 的 model fallback chain
- 不重写 TeamManager 的消息系统
- 不改变现有 team 工具接口
- 不实现 sidebar UI
