## Context

Harness 流水线（`.opencode/skills/harness/SKILL.md`）的步骤 6 验收当前是纯文本指令——agent 展示变更摘要 + diff stat 后调用 `AskUserQuestion` 等待用户回复「通过/修改」。这意味着每个 change 的验收都依赖人工逐项核对，无法端到端自动化。

同时，仓库已存在 `team-verify` skill（`.opencode/skills/team-verify/SKILL.md`），它演示了一套成熟的 httpClient 驱动验收模式：

- 启动真实 server（`bun run dev --serve` 或测试中 `createRealServer()` + `createHttpServer({port:0})`）
- 通过 HttpClient / fetch 调用核心 API
- 监听 SSE `/events` 收集事件
- 读取 JSONL 日志（`~/.config/openagent/logs/teams/<date>.jsonl`）断言
- 汇总 PASS/FAIL 报告

`tests/team-e2e-llm.test.ts` 已经验证了 `createRuntime({cwd, mode:"new"}) → createServer({runtime, skillManager, cwd}) → createHttpServer({server, port:0})` 的启动模式可行，端口通过 `httpServer.address().port` 获取。

但 `team-verify` 只覆盖 Team 模式。需要把这套模式泛化为面向任意 change 的通用验收机制。

```
 ┌──────────────────────────────────────────────────────────────────────┐
 │                       Harness Pipeline                               │
 │                                                                      │
 │   ... ──▶ 5.归档 ──▶ ┌────────────────────────────┐ ──▶ 7.合并清理   │
 │                      │ 6.验收 (本次改造)           │                  │
 │                      │                            │                  │
 │                      │  ┌──────────────────────┐  │                  │
 │                      │  │ /opsx-accept skill   │  │                  │
 │                      │  └──────────┬───────────┘  │                  │
 │                      │             ▼              │                  │
 │                      │  ┌──────────────────────┐  │                  │
 │                      │  │ Layer 0: bun run     │  │                  │
 │                      │  │   check (tsc+biome+  │  │                  │
 │                      │  │   test)              │  │                  │
 │                      │  └──────────┬───────────┘  │                  │
 │                      │             ▼              │                  │
 │                      │  ┌──────────────────────┐  │                  │
 │                      │  │ Layer 1: smoke test  │  │                  │
 │                      │  │  createRealServer()  │  │                  │
 │                      │  │  + HttpServer :0     │  │                  │
 │                      │  │  + HOME 隔离         │  │                  │
 │                      │  │  + 127.0.0.1 绑定    │  │                  │
 │                      │  │  HttpClient GET 端点 │  │                  │
 │                      │  │  + /events SSE 订阅  │  │                  │
 │                      │  │  (不调 /prompt)      │  │                  │
 │                      │  └──────────┬───────────┘  │                  │
 │                      │             ▼              │                  │
 │                      │  ┌──────────────────────┐  │                  │
 │                      │  │ Layer 2 (可选):      │  │                  │
 │                      │  │  change/acceptance.  │  │                  │
 │                      │  │  md 定制断言         │  │                  │
 │                      │  │  (Smoke/Manual QA/   │  │                  │
 │                      │  │   Log Assertions)    │  │                  │
 │                      │  └──────────┬───────────┘  │                  │
 │                      │             ▼              │                  │
 │                      │  ┌──────────────────────┐  │                  │
 │                      │  │ 汇总报告 PASS/FAIL   │  │                  │
 │                      │  │ + diff stat          │──┼──▶ ★ 用户确认   │
 │                      │  └──────────────────────┘  │   (保留, 但轻量)│
 │                      └────────────────────────────┘                  │
 └──────────────────────────────────────────────────────────────────────┘
```

## Goals / Non-Goals

**Goals:**
- 泛化 team-verify 的 httpClient 驱动验收模式，覆盖任意 change
- 三层断言：静态检查（`bun run check`）、端点可达性烟测（真实 server + HttpClient GET 端点 + SSE 订阅，**不触发 LLM**）、change 级定制（可选 `acceptance.md`，含 Smoke/Manual QA/Log Assertions 三段）
- 烟测环境隔离：临时 HOME + 127.0.0.1 绑定，不污染用户配置、不消耗 LLM token、不暴露到网络
- 共享测试 helper（`tests/helpers/real-server.ts`），避免 copy-paste 漂移
- 产出结构化报告，用户基于报告拍板而非逐项核对
- 集成到 harness 步骤 6，保留用户最终确认（不做全自动合并）

**Non-Goals:**
- 不做全自动合并（保留 ★ 用户参与）
- 不重写 team-verify（并存）
- 不新增 HTTP 端点（复用现有）
- 不引入验收 DSL / 框架
- 不做性能/压力测试
- 不修改 OpenSpec CLI

## Decisions

### D1: 验收载体选「纯 skill + 烟测脚本」，不引入 AcceptanceRunner 代码库

**选择**: 新增 `opsx-accept` skill（纯指令文档，类似 team-verify）+ `tests/acceptance-smoke.test.ts` 烟测脚本。不新建 `src/acceptance/runner.ts` 抽象。

**替代方案**: 代码级 `AcceptanceRunner` 库——拒绝，理由：① team-verify 纯 skill 模式已工作良好，证明 agent 能正确执行指令式验收 ② 代码抽象会引入新的维护面，MVP 不需要 ③ 烟测脚本（bun test）本身就是可执行的可复用代码，足以覆盖 Layer 1 ④ change 级断言用 markdown 表达最灵活。

**理由**: 最小变更原则。先验证「skill + 烟测脚本」组合够用，未来若有重复才考虑提取代码抽象。

### D2: 三层验收策略，每层独立判定 PASS/FAIL/SKIP

**选择**:

| 层 | 内容 | 失败处理 | 默认状态 |
|----|------|----------|----------|
| Layer 0 | `bun run check`（typecheck + lint + test） | 失败即整体 FAIL，必须修复 | 必跑 |
| Layer 1 | 烟测：启动真实 server（隔离 HOME + 127.0.0.1），HttpClient GET `/session/id`、`/model`、`/messages`、`/sessions`、`/events` SSE 订阅建立、`POST /abort` 端点存在性（不调 `/prompt`） | 失败记录，不阻断（视 change 范围） | `ACCEPTANCE_SMOKE=1` 显式启用 |
| Layer 2 | change 自带 `openspec/changes/<change>/acceptance.md` 定制断言（Smoke/Manual QA/Log Assertions 三段；team change 可在 Log Assertions 段查 JSONL，非 team change 该段自然空） | agent 解析并执行 | 有文件则跑 |

**关于「不调 `/prompt`」的关键事实**：`POST /prompt` 的 handler `await server.handlePrompt(text)` 会阻塞到 `session.prompt()` 完整结束（含 LLM 调用 + 工具循环）。无法「先等 {ok:true} 再 abort」——这是顺序不可能。且即使并发 abort，LLM 请求已经发出会消耗 token。因此烟测只验证 GET 端点可达性 + SSE 订阅建立，完全不触发 agent turn。

**关于「不独立设日志层」**：JSONL 日志仅由 `src/teams/logger.ts` 写入。非 team change 的烟测不产生任何 team 事件，独立设层会永远 SKIP，名不副实。因此把日志断言并入 Layer 2 的 `acceptance.md` Log Assertions 段——team change 在此段写要检查的事件，非 team change 该段为空。

**替代方案**: 只做 Layer 0 + Layer 2——拒绝，理由：缺 Layer 1 烟测无法发现「server 启不起来 / 路由挂了 / SSE 断了」这类集成问题。

**理由**: 三层从静态到动态、从通用到定制，覆盖度递进且每层都名副其实；每层独立判定便于定位问题；Layer 1 默认 skip 是为避免污染日常 `bun run check`（启动 server 慢）。

### D3: 烟测脚本复用提取后的共享 helper，强制环境隔离

**选择**: 把 `tests/team-e2e-llm.test.ts` 中的 `createRealServer()` 提取为 `tests/helpers/real-server.ts` 导出函数，烟测和 team e2e 共享。helper 内强制三项隔离：

1. **临时 HOME**：`os.tmpdir()/openagent-test-<pid>/` 作为隔离 HOME，`createRuntime` 和 logger 都写入此处，不污染用户 `~/.config/openagent/`
2. **127.0.0.1 绑定**：`httpServer.listen(port, "127.0.0.1")`，不暴露到所有网络接口（Node 默认 `::`/`0.0.0.0` 有安全风险）
3. **不调用 `/prompt`**：避免触发真实 LLM turn 消耗 token

**替代方案 A**: 启动子进程 `bun run dev --serve --port 0` 并解析 stdout——拒绝，理由：① 子进程管理复杂（清理、信号、超时）② stdout 没有结构化端口输出 ③ 进程内调用更快、更可控。

**替代方案 B**: 在烟测内 copy-paste `createRealServer()`——拒绝，理由：`createRuntime` 签名变化时副本会静默失效；提取共享 helper 一次到位。

**理由**: 不重复造轮子；进程内调用避免 IPC 开销；端口 0 让 OS 分配避免冲突；环境隔离是生产质量必备——烟测绝不能修改用户真实配置或消耗真实 token。

### D4: change 级定制断言用 markdown，不用代码

**选择**: change 目录下可选地放 `acceptance.md`，结构约定：

```markdown
## Smoke
- 启动 server 后调用 GET /xxx 应返回 yyy
- POST /xxx 应触发 SSE 事件 zzz

## Manual QA
- 启动 TUI，输入 /xxx 命令，应看到 yyy
- 跑 `bun run dev`，验证 zzz

## Log Assertions
- JSONL 日志应含 event=xxx（仅 team change 有意义）
```

`opsx-accept` skill 指示 agent 读取此文件，逐项执行并把结果填入报告。`Log Assertions` 段对 team change 用于查 JSONL 团队事件，非 team change 该段留空（自然 SKIP）。

**替代方案**: `acceptance.spec.ts` 可执行断言——拒绝，理由：① 不是所有断言都适合代码化（TUI 视觉验证、人工 QA 步骤）② markdown 更灵活，agent 可以执行 bash 命令、调用 HttpClient、甚至启动 Playwright ③ 可代码化的断言已由 `tests/acceptance-smoke.test.ts` 承载。

**理由**: 分工清晰——通用代码化的进 smoke test，change 特定的灵活进 acceptance.md。

### D5: 保留 ★ 用户最终确认，不做全自动合并

**选择**: 验收报告产出后，agent 仍调用 `AskUserQuestion` 请求用户确认「通过/修改/拒绝」。

**替代方案**: 验收全 PASS 即自动 merge——拒绝，理由：① 自动化断言无法覆盖「设计意图是否达成」「代码品味」「隐性需求」② 全自动合并坏代码风险高 ③ 用户原话「让项目自动化开发」意为减少手工核对劳动，非取消人工把关。

**理由**: 安全优先；自动验收把人工劳动从「逐项核对」降到「看报告拍板」，已经实现「让项目自动化开发」的核心价值；未来可加配置项 `harness.autoMergeOnAccept: true` 支持全自动，不在 MVP。

## Risks / Trade-offs

- **[Risk] Layer 1 烟测启动真实 server 慢（createRuntime 要加载 skills/MCP）** → 缓解：默认 skip，仅 `ACCEPTANCE_SMOKE=1` 时跑；harness 验收时显式启用；预估单次 Layer 1 跑 15-30s server 启动 + 5-6 用例 ≈ 总计 1-2 分钟，可接受
- **[Risk] createRealServer 失败（依赖未装、配置缺失、MCP 加载失败）** → 缓解：Layer 1 失败不阻断，降级为 WARN，Layer 0 + Layer 2 仍可独立跑；报告明确标注失败原因
- **[Risk] acceptance.md 被 agent 误解执行** → 缓解：markdown 结构约定明确（Smoke/Manual QA/Log Assertions 三段），skill 给出执行范式；agent 执行偏差是纯 skill 方案的固有 trade-off，team-verify 已验证可行范围
- **[Risk] SSE 连接建立失败或超时** → 缓解：烟测 SSE 用例设 5s 超时，超时记 SKIP 不阻断；HTTP 端点用例设 30s 超时
- **[Risk] 并发 harness 验收污染（多个 worktree 同时跑）** → 缓解：每个烟测用 `os.tmpdir()/openagent-test-<pid>-<rand>/` 唯一隔离 HOME，避免日志/配置交叉污染
- **[Trade-off] 纯 skill 方案的一致性依赖 agent 理解** → 接受：team-verify 已验证可行；未来若不一致再考虑代码抽象
- **[Trade-off] 烟测不调 `/prompt` 导致 agent turn 集成路径无覆盖** → 接受：POST /prompt 阻塞特性使得「不消耗 token 测试」不可能；agent turn 级集成验证留给 team-e2e-llm.test.ts（Layer 2 via acceptance.md 可引用）
- **[已消除] 服务器绑定所有接口** → 修复：`httpServer.listen(port, "127.0.0.1")`
- **[已消除] 烟测污染用户配置** → 修复：临时 HOME 隔离
- **[已消除] 烟测消耗 LLM token** → 修复：不调 `/prompt`
