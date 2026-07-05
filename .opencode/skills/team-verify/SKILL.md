---
name: team-verify
description: Team 模式自动化验收。通过 httpClient + SSE 事件流 + JSONL 日志埋点验证 team 功能，替代手动 TUI 测试。当用户需要验证 team 模式改动、跑 team 回归测试、或验收 team 功能时触发。
license: MIT
metadata:
  author: openagent
  version: "1.0"
---

# team-verify：Team 模式自动化验收

通过 httpClient + SSE 事件流 + JSONL 日志埋点验证 team 功能，替代手动 TUI 测试。

---

## 触发条件

当用户需要：
- 验证 team 模式改动（"验证 team"、"test team"、"跑 team 测试"）
- 验收 team 功能（"验收 team"、"team 回归"）
- 调试 team 问题（"team 有问题"、"team 不工作"）

---

## 验收流程

### Step 1: 启动 serve

```bash
# 在项目根目录启动 HTTP server（后台）
bun run dev --serve --port 0
```

如果项目没有 `--serve` 模式，手动启动：

```bash
# 找到可用端口，启动 HttpServer
# 记录 baseUrl = http://localhost:<port>
```

**验证**：GET `/session/id` 返回 200 → serve 就绪

---

### Step 2: Layer 1 — HTTP 路由层测试（mock server）

直接运行已有的 Layer 1 测试：

```bash
bun test tests/team-http-v2.test.ts
```

**预期结果**：27 pass, 0 fail

**覆盖**：
- V2 member CRUD（create / list / get / remove / 400 on working）
- V2 task CRUD（assign / list / status / 404）
- V2 message（send / read inbox / broadcast）
- mode 扩展（team / orchestrator）
- HttpClient V2 方法（createMember / removeMember / assignTask / sendMessage / fetch*）

---

### Step 3: Layer 2 — 真实 LLM 验收测试

启用 Layer 2 测试：

```bash
RUN_LLM_TESTS=1 bun test tests/team-e2e-llm.test.ts
```

**测试用例**（严格限制复杂度）：

| 用例 | 描述 | maxTurns | 超时 |
|------|------|----------|------|
| member 生命周期 | create → assign 单 turn 任务 → 等待 done/error | 1 | 60s |
| SSE 事件流 | 监听 /events → 断言 agent_end 事件到达 | 1 | 60s |
| JSONL 日志 | 读取日志文件 → 断言 member_status_changed 事件 | - | 10s |

**验证要点**：
- member status 转换：idle → working → done/error
- task status 转换：in_progress → done/blocked
- SSE 事件到达（agent_end / team_worker_event）
- JSONL 日志包含预期事件

**超时清理**：超时后调用 `handleCancelAllWorkers()` + 关闭 HttpServer

---

### Step 4: 日志断言

读取 `~/.config/openagent/logs/teams/<date>.jsonl`：

```typescript
// 过滤 team 相关事件
const teamEvents = entries.filter(e =>
  e.event === "worker_event" ||
  e.event === "member_status_changed" ||
  e.event === "status_snapshot"
);
```

**验证**：
- 每次 member 创建/状态变更都有对应日志条目
- 日志包含正确的 memberId（前 10 字符截断）
- 日志时间戳单调递增

---

### Step 5: 汇总报告

```
## Team 验收报告

**Layer 1 (HTTP 路由)**: ✅ 27/27 pass
**Layer 2 (真实 LLM)**: ✅ 3/3 pass / ⚠️ 1 skip / ❌ 1 fail
**日志一致性**: ✅ 预期事件全部命中

**总结**: PASS / FAIL
```

---

## API 参考

### V2 Team HTTP 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/team/members` | 创建 member |
| GET | `/team/members` | 列出所有 member |
| GET | `/team/members/:id` | 获取单个 member |
| DELETE | `/team/members/:id` | 删除 member（working 时返回 400） |
| POST | `/team/tasks` | 分配任务给 member |
| GET | `/team/tasks` | 列出所有 task |
| GET | `/team/tasks/:id` | 获取 task 状态 |
| POST | `/team/messages` | 发送消息 |
| GET | `/team/inbox` | 读取收件箱（?memberId= 可选） |
| POST | `/mode` | 设置模式（支持 team/orchestrator） |

### HttpClient V2 异步方法

| 方法 | 说明 |
|------|------|
| `createMember(opts)` | POST /team/members |
| `removeMember(id)` | DELETE /team/members/:id |
| `assignTask(opts)` | POST /team/tasks |
| `sendMessage(from, to, content)` | POST /team/messages |
| `fetchMember(id)` | GET /team/members/:id |
| `fetchMembers()` | GET /team/members |
| `fetchTasks()` | GET /team/tasks |
| `fetchTaskStatus(id)` | GET /team/tasks/:id |
| `fetchInbox(memberId?)` | GET /team/inbox |

> 同步方法 `getMember` / `listMembers` / `listTasks` / `taskStatus` / `readInbox` 仍 throw NotSupportedError（HTTP 天然异步），使用对应的 `fetch*` 异步方法替代。

---

## 护栏

- Layer 2 测试默认 skip，需 `RUN_LLM_TESTS=1` 显式启用
- Layer 2 每个用例限制 maxTurns=1，prompt < 20 token
- 超时 60s 后自动 cancelAllWorkers + 关闭 server
- 不验证 LLM 输出内容，只验证结构性断言（status 转换、事件到达、日志存在）
