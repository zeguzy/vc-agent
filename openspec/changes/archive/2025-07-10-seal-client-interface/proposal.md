## Why

AgentClient 接口暴露了 6 个内部对象 getter（`getSession`/`getRuntime`/`getSkillManager`/`getSettingsManager`/`getModelRegistry`/`getAuthStorage`），违反了 CS 架构提案的核心目标——"AgentClient 是 TUI 与 Server 之间的通信契约，屏蔽 Server 实现细节"。HttpClient 对这些方法只能抛 NotSupportedError，远程化名存实亡。TUI 通过这些 getter 可以绕过 Client-Server 边界直接操作 Server 内部对象，架构分离不完整。

## What Changes

- **BREAKING** 从 `AgentClient` 接口移除 6 个内部对象 getter：`getSession()`、`getRuntime()`、`getSkillManager()`、`getSettingsManager()`、`getModelRegistry()`、`getAuthStorage()`
- 新增 ~16 个值类型方法替代，覆盖 TUI 实际使用的内部 API 表面
- `AgentServer` 新增对应 handle 方法
- `InProcessClient` 和 `HttpClient` 实现新方法
- HTTP Server 新增 REST 端点
- TUI 层迁移所有调用点（App.tsx、commands.ts、ModelPicker.tsx、InputBox.tsx、settings/）
- `SettingContext` 类型重构：移除内部对象字段，改用 AgentClient 方法
- `ModelInfo` 类型扩展：新增 `provider`/`reasoning`/`input` 字段

### Non-goals

- 不拆分 CommandContext（后续 Change 2）
- 不引入 Server 状态机（后续 Change 3）
- 不引入权限体系（后续 Change 4）
- 不改变 AgentServer 的内部组合方式
- 不改变 Pi SDK agent loop 逻辑
- 不改变 session 持久化格式

## Capabilities

### New Capabilities

- `client-value-api`: AgentClient 接口的值类型方法层——替代内部对象 getter，提供 session 操作、skill 操作、model 查询、auth 查询、settings 操作的值类型 API

### Modified Capabilities

- `agent-client`: AgentClient 接口移除 6 个内部对象 getter，新增 ~16 个值类型方法
- `agent-server`: AgentServer 新增对应 handle 方法，支持值类型 API 的服务端实现
- `tui-settings`: SettingContext 类型重构，移除内部对象字段，改用 AgentClient 值类型方法

## Impact

- **修改文件**：`src/client/types.ts`、`src/client/in-process.ts`、`src/client/http.ts`、`src/server/index.ts`、`src/server/http.ts`、`src/tui/App.tsx`、`src/tui/commands.ts`、`src/tui/components/ModelPicker.tsx`、`src/tui/components/InputBox.tsx`、`src/settings/types.ts`、`src/settings/definitions.ts`
- **新增类型**：`UserMessageSummary`、`NavigateResult`、`SkillListResult`、`SkillDirectories`、`LoadSkillResult`、`ExtendedModelInfo`（含 provider/reasoning/input）
- **不变文件**：`src/agent/`、`src/tools/`、`src/skills/manager.ts`、`src/lsp/`、`src/poll/`、`src/session/`、`src/teams/`
- **依赖**：不引入新 npm 依赖
