---
name: opsx-accept
description: 通用 httpClient 驱动验收。三层断言（静态检查、端点可达性烟测、change 级定制）+ 结构化报告。harness 步骤 6 自动调用；用户显式触发也支持。复用 team-verify 的「真实 server + HttpClient + SSE」模式，泛化到任意 OpenSpec change。
license: MIT
metadata:
  author: openagent
  version: "1.0"
---

# opsx-accept：通用 httpClient 驱动验收

把任意 OpenSpec change 的验收从「纯人工逐项核对」升级为「httpClient 驱动的三层自动验收 + 报告展示 + 用户最终确认」。复用 `team-verify` 验证过的「启动真实 server + HttpClient + SSE」模式，泛化到 harness 步骤 6。

---

## 触发条件

- harness 流水线步骤 6（验收）自动调用本 skill
- 用户显式 `/opsx-accept`、`/opsx-accept <change-name>`
- 用户说「验收」「accept」「跑验收」「验收这个 change」

**与 team-verify 边界**：team 模式 change 优先用 `team-verify`（专测 team V2 API + 真实 LLM 生命周期）；本 skill 通用，覆盖任意 change 的端点可达性 + change 级定制断言。两者可互补使用。

---

## 三层验收流程

### Layer 0：静态检查（必跑）

```bash
bun run check
```

`package.json` 的 `check` = `typecheck && lint && test`（tsc --noEmit + biome check + bun test）。

**判定**：
- ✅ PASS：全绿
- ❌ FAIL：任一步骤失败 → 整体验收 FAIL，**必须修复才能继续**

**失败处理**：回 harness 步骤 4 实施修复，不接受跳过。

---

### Layer 1：端点可达性烟测（显式启用）

```bash
ACCEPTANCE_SMOKE=1 bun test tests/acceptance-smoke.test.ts
```

**默认 SKIP**（避免污染日常 `bun run check`，启动 server 慢）。harness 步骤 6 验收时 agent 显式设 `ACCEPTANCE_SMOKE=1` 启用。

**烟测内容**（不调 `/prompt`，详见护栏）：
1. 进程内启动隔离的真实 server（`createRealServer()` + `createHttpServer({server, port:0, host:"127.0.0.1"})`）
2. 临时 HOME 隔离（`os.tmpdir()/openagent-test-<pid>-<rand>/`），不污染用户 `~/.config/openagent/`
3. 核心 GET 端点烟测：`/session/id`、`/model`、`/messages`、`/sessions` 全部 200
4. SSE `/events` 订阅建立（5s 超时记 SKIP）
5. `POST /abort` 端点存在性（返回 200）

**判定**：
- ✅ PASS：全部用例通过
- ⚠️ SKIP：环境变量未设、或 SSE 5s 未建立（不阻断）
- ❌ FAIL：核心端点返回非 200、server 启不起来（视 change 范围降级为 WARN 或回步骤 4）

**失败处理**：Layer 1 失败不强制阻断（视 change 是否改 server 而定）。报告标注失败详情，由 harness 决策。

---

### Layer 2：change 级定制断言（可选）

读取 `openspec/changes/<active-change>/acceptance.md`（无文件则 SKIP）。

**acceptance.md 三段结构**：

```markdown
## Smoke
- 程序化验证：跑某个命令、调用某端点、检查某文件等
- 示例：`ACCEPTANCE_SMOKE=1 bun test tests/xxx.test.ts` 应全 PASS

## Manual QA
- 人工/agent 验证步骤：读某文件应触发某行为、某 skill 应在某条件下激活
- 示例：阅读 .opencode/skills/xxx/SKILL.md 触发条件应能被识别

## Log Assertions
- 日志断言（仅 team change 有意义）：JSONL 日志应含某事件
- 示例：~/.config/openagent/logs/teams/<date>.jsonl 应含 event=member_created
```

agent 逐段执行，缺失段落记 SKIP。`Log Assertions` 段对非 team change 自然空（无 team 日志写入）。

**判定**：
- ✅ PASS：存在的段落全部通过
- ⚠️ SKIP：无 acceptance.md、或某些段落缺失（部分 SKIP）
- ❌ FAIL：存在的段落有失败项 → 报告详情，由 harness 决策

---

## 汇总报告模板

执行完三层后，产出结构化报告：

```
## 验收报告：<change-name>

**变更摘要**：<proposal.md 第一段 Why 浓缩>

**自动验收结果**：
| Layer | 内容 | 状态 | 详情 |
|-------|------|------|------|
| Layer 0 | bun run check | ✅ PASS / ❌ FAIL | <失败步骤 + 错误摘要> |
| Layer 1 | 端点可达性烟测 | ✅ PASS / ⚠️ SKIP / ❌ FAIL | <失败用例 + 详情> |
| Layer 2 | change 级定制 | ✅ PASS / ⚠️ SKIP / ❌ FAIL | <失败段落 + 详情> |

**变更文件（git diff --stat main...HEAD）**：
<diff --stat 输出>

**完成任务**：
- [x] Task 1: ...
- [x] Task 2: ...

**当前 worktree**：<pwd 输出>
**当前分支**：<git branch --show-current>

**最终判定**：✅ PASS（请求用户确认）/ ❌ FAIL（回步骤 4 修复）

请确认是否通过验收。
```

调用 `AskUserQuestion` 请求用户最终拍板。**保留 ★ 用户参与点——自动验收减少核对劳动，不取消人工把关。**

---

## API 参考

### 烟测通过 HttpClient 类驱动（`src/client/http.ts`）

烟测不使用裸 `fetch`，而是用项目的 `HttpClient` 类验证完整客户端集成：

```typescript
const client = new HttpClient(baseUrl);
await client.init();  // 并行 GET /session/id, /session/name, /session/file,
                      // /model, /context, /messages 填充缓存
```

| HttpClient 方法 | 验证点 | 对应端点 |
|-----------------|--------|----------|
| `init()` | 6 个 GET 端点并行返回有效 JSON | `/session/id` `/session/name` `/session/file` `/model` `/context` `/messages` |
| `getSessionId()` | 缓存填充，返回非空 string | `/session/id` |
| `getModel()` | 缓存填充，返回 ModelInfo | `/model` |
| `getMappedMessages()` | 缓存填充，返回数组 | `/messages` |
| `listSessions()` | async GET 返回数组 | `/sessions` |
| `subscribe(handler)` | 返回 Unsubscribe fn，内部建立 SSE 连接不抛错 | `/events` |
| `abort()` | async POST 不抛错（不触发 agent turn） | `/abort` |

**不调 `client.prompt()`**：该方法的 handler `await server.handlePrompt()` 阻塞至完整 agent turn（LLM 调用 + 工具循环），会消耗 token。

### 共享 helper

`tests/helpers/real-server.ts` 导出：

```typescript
createRealServer(opts?: { cwd?: string }): Promise<{
  server: AgentServer;
  runtime: Runtime;
  skillManager: SkillManager;
  restoreHome: () => void;  // 还原 process.env.HOME
}>
```

强制三项隔离：① 临时 HOME ② 返回后由调用方绑定 127.0.0.1 ③ 不调 `client.prompt()`。

---

## 护栏

- **Layer 1 默认 skip**：避免污染 `bun run check`（启动 server 慢，15-30s）；harness 验收时显式启用
- **不调 `/prompt`**：该端点 handler `await server.handlePrompt()` 阻塞至完整 agent turn（含 LLM 调用 + 工具循环），无法「先等 {ok:true} 再 abort」；且并发 abort 仍会消耗 token。烟测仅验证 GET 端点 + SSE 订阅 + abort 存在性
- **SSE 5s 超时**：连接建立超时记 SKIP 不 FAIL（因不触发 agent turn，本来也无事件可收）
- **环境隔离**：临时 HOME（`os.tmpdir()/openagent-test-<pid>-<rand>/`）、127.0.0.1 绑定，不污染用户配置、不暴露到网络、不消耗 LLM token
- **保留用户最终确认**：自动验收全 PASS → 展示报告 → 仍调用 `AskUserQuestion` 请求用户拍板 → 用户确认后才进入合并清理
- **不做全自动合并**：自动断言无法覆盖设计意图、代码品味、隐性需求；保留 ★ 用户参与点是安全优先
- **与 team-verify 并存**：team change 优先 team-verify（专测 team V2 API + LLM 生命周期）；本 skill 通用，覆盖端点可达性 + change 级定制
- **acceptance.md 是约定非强制**：change 可选携带；无文件则三层降级为 Layer 0 + Layer 1（Layer 2 SKIP）
