## Why

系统缺少通用的"后台任务"抽象。当前 subagent 工具只支持同步阻塞模式——agent 调用 subagent 后必须等待结果才能继续。用户无法在 agent 工作时继续对话，也无法同时运行多个独立任务。`/btw` 侧边对话功能也因为没有后台任务基础而难以正确实现。

OpenCode 已验证了 background subagent 模式：`task(background=true)` 让 subagent 在后台运行，主 agent 立即返回，完成后结果自动注入父会话。

## What Changes

- **新增 BackgroundJobService**：进程内注册表 `Map<string, ActiveJob>`，管理后台任务生命周期（start/wait/cancel/promote/list）
- **扩展 subagent 工具**：新增 `background: boolean` 参数，`true` 时 fork 到独立 scope 执行，立即返回 task_id
- **新增 task_status 工具**：agent 可查询后台任务状态（OpenCode 的设计原则：agent 不应主动轮询，但提供查询能力以备需要）
- **结果注入机制**：后台任务完成后，向父会话注入合成消息（`synthetic: true`），触发父 agent 继续推理
- **TUI 背景任务卡片**：消息列表中显示后台任务卡片（复用 SubagentMessageView 样式），支持实时状态更新
- **Promote 机制**：前台 subagent 运行中可通过快捷键提升为后台
- **`/btw` 基于后台任务重写**：`/btw` = promote 当前前台任务为后台 + 创建新的空白会话继续对话

## Capabilities

### New Capabilities

- `background-job-service`: 后台任务注册表 + 生命周期管理（start/wait/cancel/promote/list）
- `background-subagent`: subagent 工具的异步执行模式（background=true）
- `task-status-tool`: 查询后台任务状态的工具
- `promote-shortcut`: 前台→后台动态切换（Ctrl+B 快捷键）
- `btw-background`: 基于 BackgroundJobService 重写的 /btw 侧边对话

### Modified Capabilities

- `subagent-tool`: 新增 background 参数和异步执行路径
- `tui-messages`: 消息列表中渲染后台任务卡片
- `agent-session`: 子会话 parentID 关系 + 权限派生

## Impact

- **新增文件**：`src/background/service.ts`（BackgroundJobService）、`src/background/types.ts`（类型定义）
- **修改文件**：`src/tools/subagent.ts`（加 background 参数）、`src/agent/session.ts`（子会话创建）、`src/tui/App.tsx`（快捷键+卡片）、`src/tui/components/SubagentMessageView.tsx`（后台任务卡片渲染）
- **删除文件**：`src/session/btw.ts`（合并到 background service）
- **无 breaking change**：subagent 工具的 background 参数默认 false，不影响现有行为

## Non-goals

- 不做后台任务持久化（进程重启丢失，与 OpenCode 一致）
- 不做跨进程后台任务（同一进程内 scope fork）
- 不做 Scheduled 模式（仅 Sync + Async）
- 不做后台任务的权限预授权（初期简化，后台任务仍可请求权限）
- 不做多级嵌套后台任务（subagent_depth 限制为 1）
