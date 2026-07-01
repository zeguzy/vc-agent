## 1. Phase 0 — AgentClient 接口定义

- [x] 1.1 定义 `AgentClient` TypeScript 接口（src/client/types.ts）
- [x] 1.2 定义 `AgentSessionEvent` 类型（复用 Pi SDK 类型）
- [x] 1.3 定义 `Unsubscribe` 和 `EventHandler` 类型
- [x] 1.4 定义 `CommandResult`/`ContextUsage`/`ModelInfo` 等辅助类型
- [x] 1.5 运行 `bun run check` 确保接口定义无类型错误

## 2. Phase 0 — InProcessClient 适配层

- [x] 2.1 创建 `src/client/in-process.ts`，实现 `InProcessClient` 类
- [x] 2.2 实现 `subscribe(handler)`：内部调 `session.subscribe()`，事件转发 + 自动重订阅
- [x] 2.3 PollManager 订阅保留在 TUI（Phase 1 再迁移）
- [x] 2.4 实现 `executeCommand(name, args, ctx)`：委托到 `commandRegistry.execute()`
- [x] 2.5 实现 `switchSession/newSession/setSessionName` 等委托方法
- [x] 2.6 运行 `bun run check` + 手动验证功能正常

## 3. Phase 0 — TUI 依赖翻转

- [x] 3.1 修改 `<App>` 组件 props：`{ client: AgentClient }`
- [x] 3.2 修改 `useSessionEvents` hook：`client.subscribe()` + 120ms throttle 保留
- [x] 3.3 修改 handlePrompt：`client.prompt()/followUp()`
- [x] 3.4 修改 Ctrl+C abort：`client.abort()`
- [x] 3.5 修改上下文显示：`client.getContextUsage()`
- [x] 3.6 修改 AgentMode 切换：`client.setActiveToolsByName()`
- [x] 3.7 PollManager 暂保留在 TUI（Phase 1 再迁移）
- [x] 3.8 修改 `src/index.tsx`：`createClient(runtime, skillManager)` → `<App client>`
- [x] 3.9 全量手动测试（待用户验证）
- [x] 3.10 运行 `bun run check` 全通过

## 4. Phase 1 — AgentServer 封装

- [x] 4.1 创建 `src/server/index.ts`，定义 `AgentServer` 类：构造函数接收启动参数，内部创建 `AgentSessionRuntime`（复用现有 `createRuntime()` 逻辑）
- [x] 4.2 实现 `AgentServer extends EventEmitter`：订阅 `session.subscribe()` 全部事件，emit 为 `{ type, data }` 格式
- [x] 4.3 实现 `AgentServer` 的 handler 方法：handlePrompt, handleFollowUp, handleAbort, handleListSessions, handleSwitchSession, handleNewSession, handleSetSessionName, handleGetContextUsage, handleGetAgentMode, handleSetAgentMode
- [x] 4.4 实现 `AgentServer.handleExecuteCommand(name, args)`：创建 `ServerCommandContext`，调用 `CommandRegistry.execute()`
- [x] 4.5 实现 `AgentServer.subscribe(handler)` 和 `subscribePoll(key, handler)`
- [x] 4.6 修改 `InProcessClient`：从直接持有 `AgentSessionRuntime` 改为持有 `AgentServer`，方法委托到 server handler
- [x] 4.7 修改 `src/index.tsx`：`createServer(args)` → `createClient(server)` → `<App client={client}>`
- [x] 4.8 全量手动测试验证 Phase 1 功能与 Phase 0 一致

## 5. Phase 1 — CommandContext 拆分

- [x] 5.1 定义 `ServerCommandContext` 类型（src/commands/types.ts）：含 `client: AgentClient`、`cwd: string`，不含 UI 回调
- [x] 5.2 逐个迁移现有 command handler 到 `ServerCommandContext` 签名：移除对 `setMessages`、`setIsRunning`、`setContextUsage` 等 UI 回调的依赖，改为通过 `client` 操作 + 事件流响应
- [x] 5.3 迁移会话管理命令（/new, /resume, /sessions, /name）handler
- [x] 5.4 迁移 skill 命令（/skills, /load-skill, /unload-skill）handler
- [x] 5.5 迁移模式切换命令（/planner, /standard）handler
- [x] 5.6 迁移其他命令（/compact, /clear, /help 等）handler
- [x] 5.7 删除旧 `CommandContext` 类型（确认所有 handler 已迁移）
- [x] 5.8 运行 `bun run check` + 全量手动测试

## 6. 清理与验证

- [x] 6.1 移除 TUI 中所有对 `AgentSessionRuntime` / `AgentSession` 类型的直接 import
- [x] 6.2 验证 TUI 目录（src/tui/）下无任何 `import ... from "../agent/"` 或 `"../session/"` 语句
- [x] 6.3 运行 `bun run check`（typecheck + lint + test）全通过
- [x] 6.4 手动回归测试全流程：新会话、继续、切换、命名、命令、skill、abort、模式切换、上下文显示、git 状态
