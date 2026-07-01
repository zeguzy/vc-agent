## Why

当前 TUI 与核心 agent 流程紧耦合：`AgentSessionRuntime` 作为 prop 直接传入 `<App>`，`session.subscribe()` 的 9 种事件直接操作 React state，`CommandContext` 混合了 6 个核心依赖和 8 个 UI 回调。这导致 UI 无法独立演进、无法支持多客户端、无法远程化。

参考 OpenCode 的 in-process fetch 模式，可以在零性能损耗下实现完整的架构分离：TUI 通过 Client 接口操作 Server，本地模式直接函数调用，远程模式替换 transport 即可。

## What Changes

- 新增 `AgentClient` 接口层：TUI 唯一依赖的 API，屏蔽 Server 实现细节
- 新增 `AgentServer`：封装当前 core 逻辑（agent loop、tools、MCP、skills、commands、session、LSP），暴露统一的请求/事件协议
- **BREAKING** 重构 TUI：移除对 `AgentSessionRuntime`、`AgentSession` 的直接依赖，改为通过 `AgentClient` 操作
- **BREAKING** 重构 `CommandContext`：拆分为 `ServerCommandContext`（核心操作）和 UI 回调（留在 TUI 侧），server 端 handler 只做逻辑、返回结构化结果
- 事件流改造：`session.subscribe()` → Client 事件订阅（本地走 EventEmitter，远程走 SSE）
- 新增 in-process transport：Client 调用直接委托到 Server handler（零 IPC 开销）

### Non-goals

- 不做 HTTP/WebSocket 远程 transport（Phase 2，未来按需）
- 不做多客户端/多终端连同一 server（Phase 2）
- 不改变 agent loop 内部逻辑（Pi SDK 集成方式不变）
- 不改变 session 持久化格式（JSONL 不变）
- 不引入 Effect 或其他重型框架（保持轻量）

## Capabilities

### New Capabilities

- `agent-client`: TUI 与 Server 之间的接口层，定义请求 API（prompt/abort/switchSession 等）和事件订阅协议
- `agent-server`: 核心引擎封装，将 agent loop、tools、MCP、skills、commands 统一暴露为请求处理 + 事件流

### Modified Capabilities

- `tui-input`: 输入处理从直接调 session 改为通过 AgentClient
- `tui-messages`: 消息渲染从 session.subscribe 直连改为 AgentClient 事件订阅
- `cli-entry`: 启动流程从 `createRuntime() → <App>` 改为 `createServer() → createClient(server) → <App>`

## Impact

- **新增文件**：`src/client/`（AgentClient 接口 + in-process 实现）、`src/server/`（AgentServer 封装）
- **重构文件**：`src/tui/App.tsx`、`src/tui/hooks/useSessionEvents.ts`、`src/commands/registry.ts`、`src/index.tsx`
- **不变文件**：`src/agent/`、`src/tools/`、`src/skills/`、`src/lsp/`、`src/poll/`、`src/session/`（被 Server 封装但不改内部逻辑）
- **依赖**：不引入新 npm 依赖
