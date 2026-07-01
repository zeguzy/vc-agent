## Context

openagent 已完成 Client-Server 架构改造（Phase 0+1）。AgentServer 是独立 facade，AgentClient 接口 transport 无关。当前只有 InProcessClient 实现 + TUI 消费者。

## Goals / Non-Goals

**Goals:**
- Headless 模式：`openagent run "prompt"` → stdout 流式输出 → exit
- HTTP Server 模式：`openagent serve` → REST API + SSE
- Remote attach 模式：`openagent attach http://localhost:4096` → TUI via HttpClient

**Non-Goals:**
- 不改变现有 TUI 流程（InProcessClient 不变）
- 不做认证/加密（本地/可信网络场景）
- 不做 session 多路复用（单 session per connection）

## Decisions

### 决策 1: Headless 用 AgentClient 而非直接调 Server

HeadlessRunner 创建 `createServer() → createClient(server)`，通过 `client.subscribe()` 监听事件。与 TUI 用完全相同的 AgentClient 接口。

### 决策 2: HTTP API 路由设计

```
POST /prompt              { text }        → { ok }
POST /follow-up           { text }        → { ok }
POST /abort               {}              → { ok }
POST /compact             { instructions? } → { ok }
POST /session/new         {}              → { cancelled }
POST /session/switch      { path }        → { cancelled }
GET  /session/id                          → { id }
GET  /session/name                        → { name }
POST /session/name        { name }        → { ok }
GET  /model                               → { model }
GET  /context                             → { tokens, contextWindow, percent }
GET  /messages                            → { messages: Message[] }
POST /mode               { mode }         → { ok }
GET  /sessions                            → { sessions: SessionInfo[] }
GET  /events               → SSE stream (agent events)
```

### 决策 3: HttpClient 对 @internal 方法抛 NotSupportedError

HttpClient 不实现 getSettingsManager/getModelRegistry/getAuthStorage/getSkillManager/getSession/getRuntime。调用时抛 `NotSupportedError`。TUI 始终用 InProcessClient，不受影响。

### 决策 4: SSE 事件格式

```
data: {"type":"message_start","message":{...}}

data: {"type":"tool_execution_start","toolName":"read","args":"...","toolCallId":"..."}

data: {"type":"agent_end"}
```

HttpClient.subscribe() 内部用 EventSource 解析 SSE，转发给 handler。

## Risks / Trade-offs

- **[HttpClient 功能受限]** → @internal 方法不支持，SettingContext 在远程模式下不可用。Mitigation：TUI 始终 in-process；远程模式主要服务 headless/脚本场景。
- **[SSE 连接管理]** → 需处理断线重连。Mitigation：Phase 2c 先做最简版（不重连），后续加 cursor replay。
