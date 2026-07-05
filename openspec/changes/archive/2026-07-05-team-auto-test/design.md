## Context

Team 模式已有完整的服务端实现（`AgentServer` + `WorkerSessionPool`），V2 member/task/message handler 均已就绪。`InProcessClient` 已完整桥接。但 HTTP 层存在缺口：

- `HttpServer`（`src/server/http.ts`）只有 V1 worker 路由，缺少 V2 team 路由
- `HttpClient`（`src/client/http.ts`）V2 方法全部 `throw new NotSupportedError`
- 现有测试（`teams-pool.test.ts`、`teams-integration.test.ts`）使用 FakeWorker mock，无法验证真实 HTTP 往返
- 日志系统（`logTeamEvent` → JSONL）已有，但无测试断言

```
         ┌──────────┐    HTTP     ┌───────────┐    direct    ┌───────────┐
         │ Test     │────────────▶│ HttpServer │────────────▶│ AgentServer│
         │ Script   │             │           │             │           │
         │          │◀─ SSE ─────│ /events   │             │ Pool      │
         │          │             │           │             │ Logger    │
         └──────────┘             └───────────┘             └─────┬─────┘
              │                                                    │
              │  read JSONL log                                   │
              ◀────────────────────────────────────────────────────┘
```

## Goals / Non-Goals

**Goals:**
- 补全 V2 Team HTTP API 路由，使 member/task/message 全部可通过 HTTP 操作
- 实现 HttpClient V2 方法，消除 NotSupportedError
- 构建端到端测试框架：真实 HttpServer + fetch API + SSE 事件 + JSONL 日志断言
- 覆盖核心场景：member 生命周期、任务分配、消息通信、取消清理

**Non-Goals:**
- 不替换现有单元测试（FakeWorker mock 的 pool 测试保留）
- 不做性能/压力测试
- 不做 TUI 层测试（本方案只覆盖 HTTP 层和 server 层）
- 真实 LLM 测试不测复杂多轮对话或高 token 消耗场景

## Decisions

### D1: HttpServer V2 路由设计遵循 REST 风格

**选择**: RESTful 路径 + JSON body

```
POST   /team/members          → createMember
GET    /team/members          → listMembers
GET    /team/members/:id      → getMember
DELETE /team/members/:id      → removeMember
POST   /team/tasks            → assignTask
GET    /team/tasks            → listTasks
GET    /team/tasks/:id        → taskStatus
POST   /team/messages         → sendMessage
GET    /team/inbox            → readInbox (?memberId=)
POST   /mode                  → 扩展支持 "team" | "orchestrator"
```

**替代方案**: RPC 风格（`POST /team/createMember`）— 拒绝，与现有路由风格不一致（现有 `/team/spawn`、`/team/cancel` 是 V1 遗留）

**理由**: V2 是新 API，用 REST 风格更清晰；V1 路由保留不动做向后兼容

### D2: HttpClient V2 方法直接映射到新路由

**选择**: 每个 V2 方法内部调用对应的 HTTP 端点

```typescript
async createMember(opts): Promise<TeamMember> {
  const res = await this.postJson("/team/members", opts);
  return res as TeamMember;
}
```

**理由**: 与现有 HttpClient V1 方法风格一致（`prompt` → `POST /prompt`，`listWorkers` → `GET /team/workers`）

### D3: 两层测试策略 — mock 层 + 真实 LLM 层

**选择**: 分两层测试

**Layer 1 — HTTP 路由层（mock AgentServer）**：
复用 `tests/http-server.test.ts` 的 `createMockServer()` 模式，扩展 mock 包含 V2 handler。验证路由解析、请求序列化、响应格式。

**Layer 2 — 真实 LLM 层（完整 AgentServer）**：
启动真实 `AgentServer` + `HttpServer`，创建 member 并分配极简任务（如 "echo hello"），验证完整生命周期。严格限制复杂度：
- 单 turn 任务（`maxTurns: 1`），避免多轮对话
- 最小 prompt（< 20 token），控制 token 消耗
- 只验证结构性断言（member status 转换、task status 转换、SSE 事件到达），不验证 LLM 输出内容
- 设置合理超时（60s），防止 LLM 响应慢导致测试挂起

**替代方案**: 纯 mock 测试 — 用户要求引入真实 LLM 以提高验收可信度

**理由**: 
- mock 层保证 HTTP 协议正确性，速度快、无外部依赖
- 真实 LLM 层验证端到端可行性，覆盖 mock 无法发现的集成问题
- 严格限制复杂度确保测试成本可控、CI 可跑

### D4: 日志断言通过读取 JSONL 文件

**选择**: 测试执行后读取 `~/.config/openagent/logs/teams/<date>.jsonl`，按 event 字段过滤断言

**理由**: `logTeamEvent` 已写入 JSONL，无需额外埋点；JSONL 便于按行解析和过滤

### D5: SSE 事件收集用 EventSource 或 fetch stream

**选择**: 复用 HttpClient 现有的 SSE 订阅机制（`fetch` + `ReadableStream`）

**理由**: 已有实现，不需要额外依赖

## Risks / Trade-offs

- **[Risk] mock server 不覆盖真实 agent 行为** → 缓解：增加 Layer 2 真实 LLM 测试补充覆盖
- **[Risk] V1 路由与 V2 路由风格不一致** → 低风险：V1 标记 deprecated，文档说明迁移路径
- **[Risk] 日志文件路径依赖 `homedir()`，CI 环境可能不同** → 缓解：测试中 mock `homedir()` 或在 setup 中创建临时日志目录
- **[Risk] 真实 LLM 测试受网络/配额影响** → 缓解：Layer 2 测试标记 `bun:test` 的 `only`/`skip` 可控，CI 中可条件跳过；设置 60s 超时防止挂起；超时后调用 `handleCancelAllWorkers()` + 关闭 HttpServer 确保资源清理
