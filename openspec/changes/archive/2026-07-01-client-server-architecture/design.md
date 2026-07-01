## Context

openagent 当前是单体进程架构。`src/index.tsx` 调用 `createRuntime()` 创建 `AgentSessionRuntime`（拥有 session + 全部服务），然后将 runtime 作为 prop 传给 `<App>`。TUI 组件直接调用 `session.prompt()`、`session.subscribe()`、`runtime.switchSession()` 等方法，与核心逻辑紧耦合。

当前耦合是**单向的**（TUI→Core，Core 从不 import TUI），这为解耦提供了干净的切点。但 TUI 直接持有 `AgentSessionRuntime` 引用、直接调 `AgentSession` 方法、直接接收 Pi SDK 事件——这些是必须切断的 5 个耦合点。

参考 OpenCode 的 in-process fetch 模式：TUI 通过 SDK client 调 API，本地模式下 fetch 直接调 server 的 request handler（零网络开销），远程模式下替换 fetch 为真实 HTTP。

## Goals / Non-Goals

**Goals:**

- TUI 不再直接持有 `AgentSessionRuntime`/`AgentSession` 引用，只依赖 `AgentClient` 接口
- 事件流通过 Client 订阅，不再直接调 `session.subscribe()`
- `CommandContext` 拆分：Server 端 handler 只接收核心操作能力，UI 回调留在 TUI 侧
- 本地运行零性能损耗（in-process 函数委托，不走 IPC）
- 为 Phase 2（HTTP/SSE 远程 transport）预留干净的 transport 切换点

**Non-Goals:**

- 不实现 HTTP/WebSocket 远程 transport
- 不支持多客户端同时连接
- 不改变 Pi SDK agent loop 内部逻辑
- 不改变 session 持久化格式
- 不引入 Effect 或其他重型框架

## Decisions

### 决策 1: AgentClient 接口而非协议消息

**选择**：TUI 依赖 TypeScript 接口 `AgentClient`，方法调用风格（`client.prompt(text)`），不使用 JSON-RPC 或消息对象。

**理由**：
- openagent 是纯 TypeScript 单语言项目，不需要语言无关的协议
- 方法调用 = 类型安全 + IDE 补全 + 编译时检查
- JSON-RPC 的优势在跨语言/跨进程，目前用不上

**替代方案**：JSON-RPC over stdio（Codex 风格）。放弃——本地模式下增加不必要的序列化开销，类型安全靠手写 mapping。

```
TUI                     AgentClient (接口)              AgentServer
 │                            │                              │
 │  client.prompt("hello")    │                              │
 │───────────────────────────►│  server.handlePrompt("hello")│
 │                            │─────────────────────────────►│
 │                            │                              │  session.prompt("hello")
 │                            │                              │  ──────► Pi SDK
 │                            │  ◄─── events flow back ──────│
 │  ◄─── client.subscribe() ──│                              │
```

### 决策 2: In-Process Transport（函数委托）

**选择**：Phase 1 只实现 in-process transport。`AgentClient` 的实现 `InProcessClient` 直接持有 `AgentServer` 引用，方法调用直接转发。

**理由**：
- 零 IPC 开销（函数调用 vs Worker postMessage ~0.1ms vs HTTP ~1-2ms）
- 同进程调试简单（正常断点）
- 架构分离已经完整（TUI 不知道 Server 怎么实现）

**替代方案**：Bun Worker Thread + MessagePort。放弃——增加调试复杂度，单进程内函数委托已足够。

```typescript
// InProcessClient 实现（示意）
class InProcessClient implements AgentClient {
  constructor(private server: AgentServer) {}
  
  prompt(text: string) { return this.server.handlePrompt(text) }
  abort() { return this.server.handleAbort() }
  subscribe(handler) { return this.server.subscribe(handler) }
  // ...
}
```

### 决策 3: 事件流用 EventEmitter 而非 SSE

**选择**：`AgentServer` 继承/组合 `EventEmitter`，Client 通过 `subscribe(handler)` 注册回调。本地模式下直接函数调用。

**理由**：
- Pi SDK 已有事件系统（`session.subscribe()`），Server 层只需转发
- EventEmitter 是 Node/Bun 标准模式，零依赖
- 未来 Phase 2 换 SSE 时，Client 接口不变，只换 transport 实现

```
Pi SDK Events              AgentServer              AgentClient              TUI (React)
 │                          │                        │                        │
 │ agent_start              │                        │                        │
 │ message_start            │ emit("event", payload) │                        │
 │ message_update (stream)  │───────────────────────►│ handler(payload)       │
 │ tool_execution_start     │                        │──────────────────────►│ setState()
 │ tool_execution_end       │                        │                        │
 │ message_end              │                        │                        │
 │ agent_end                │                        │                        │
```

### 决策 4: CommandContext 拆分

**选择**：将当前 19 字段的 `CommandContext` 拆为两部分：

- `ServerCommandContext`：传给 server 端 command handler，只含核心操作（`client: AgentClient`、`cwd: string`）
- UI 回调（`setMessages`、`setIsRunning` 等）：留在 TUI 侧，由 command 执行结果驱动

**理由**：
- 当前 command handler 混合了逻辑操作和 UI 副作用，是耦合的最大来源
- 拆分后 server 端 handler 可测试（不需要 React mock）
- UI 更新改为事件驱动：handler 返回结果/emit 事件 → Client/TUI 响应

### 决策 5: AgentServer 封装而不重写

**选择**：`AgentServer` 是一个薄封装层，组合现有模块（`AgentSessionRuntime`、`SessionManager`、`SkillManager`、`CommandRegistry`、`PollManager`、`LspClient`），不重写它们的内部逻辑。

**理由**：
- 降低改造风险（不动已验证的逻辑）
- 增量迁移：先封装、后优化
- 如果某个模块需要深度改动，在后续 change 中单独处理

```
┌─ AgentServer ─────────────────────────────────────┐
│  组合（不修改内部）：                                │
│  · AgentSessionRuntime (session + services)        │
│  · SessionManager (持久化、切换)                    │
│  · SkillManager (发现、注入)                        │
│  · CommandRegistry (命令执行)                       │
│  · PollManager (git 状态轮询)                       │
│  · LspClient (诊断、定义、引用)                     │
│                                                    │
│  新增：                                             │
│  · EventEmitter (事件转发)                          │
│  · handlePrompt/handleAbort/handleSwitchSession... │
└────────────────────────────────────────────────────┘
```

## Risks / Trade-offs

- **[改造范围大]** → 分 Phase 实施，Phase 0 先定义接口 + 改 TUI 依赖（不改行为），验证通过后再做 Phase 1 封装
- **[CommandContext 拆分是破坏性改动]** → 现有 command handler 都要改签名。Mitigation：提供适配器函数，渐进迁移
- **[事件批处理丢失]** → 当前 `useSessionEvents` 有 120ms throttle。Mitigation：在 Client 事件层保留同样的批处理逻辑
- **[PollManager 订阅模式变化]** → 当前 TUI 直接 `pollManager.subscribe()`。Mitigation：Client 暴露 `subscribePoll()` 转发

## Migration Plan

1. **Phase 0 — 接口定义 + TUI 依赖翻转**（不改行为）
   - 定义 `AgentClient` 接口
   - 创建 `InProcessClient` 适配当前 runtime（薄 wrapper，直接委托）
   - TUI 改为依赖 `AgentClient` 接口
   - 所有功能行为不变，只是多了一层间接

2. **Phase 1 — Server 封装 + CommandContext 拆分**
   - 创建 `AgentServer`，封装现有模块
   - 拆分 `CommandContext` → `ServerCommandContext` + UI 回调
   - 事件流改为 Server → Client EventEmitter
   - 迁移所有 command handler 到新签名

3. **Phase 2 — 远程 transport（未来）**
   - HTTP Server + SSE 事件流
   - HTTP Client 实现
   - 多客户端支持

**回滚策略**：Phase 0 和 Phase 1 之间保持 `AgentSessionRuntime` 可直接传入 `<App>` 的兼容路径（feature flag），可随时回退。
