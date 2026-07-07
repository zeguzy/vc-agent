## Why

Harness 流水线的步骤 6（验收）当前是纯 skill 文本指令——agent 展示变更摘要后等待人工「确认通过」。这意味着每个 change 都需要用户坐在终端前逐项核对，无法真正端到端自动化。已有的 `team-verify` skill 已经证明「httpClient + SSE + JSONL 日志断言」的模式可以驱动 Team 模式的自动化验收，但它只覆盖 Team 一个面。

需要把这套 httpClient 驱动验收模式泛化到任意 change，让 harness 步骤 6 从「纯人工确认」升级为「httpClient 自动验收 + 报告展示 + 用户最终把关」，打通「探索→提案→审核→实施→归档→**验收**→合并」全链路的自动化瓶颈。

## What Changes

- **新增 `opsx-accept` skill**：通用 httpClient 驱动验收 skill。三层验收：① `bun run check`（typecheck+lint+test）② 真实 server 启动 + HttpClient 烟测核心 GET 端点可达性 + `/events` SSE 订阅建立（**不调用 `/prompt`**，避免触发真实 LLM turn）③ change 自带 `acceptance.md` 定制断言（可含 Smoke / Manual QA / Log Assertions 三段，Log Assertions 段对 team change 有意义，非 team change 自然 SKIP）。产出结构化报告（PASS/FAIL/SKIP）。
- **提取共享测试 helper `tests/helpers/real-server.ts`**：把 `team-e2e-llm.test.ts` 中的 `createRealServer()` 闭包提取为可复用导出函数，供烟测和 team e2e 共享，避免 copy-paste 漂移。同时在 helper 内做环境隔离：临时 HOME（`os.tmpdir()` 子目录）+ 绑定 `127.0.0.1`（不暴露到所有网络接口）。
- **新增通用烟测脚本 `tests/acceptance-smoke.test.ts`**：调用提取后的 `createRealServer()` + `createHttpServer({server, port:0, host:"127.0.0.1"})`，对 server 做最小可达性验证。整套用 `describe.skip` 包裹，需 `ACCEPTANCE_SMOKE=1` 显式启用避免污染 `bun run check`。
- **约定 change 可选携带 `acceptance.md`**：change 目录下可选地放一个 `acceptance.md`，列出该 change 特有的验收场景。`opsx-accept` 读取并执行。无此文件则只跑前两层通用验收。
- **修改 harness `SKILL.md` 步骤 6**：把「展示摘要 + 等待用户确认」改为「调用 `/opsx-accept` 跑自动验收 → 展示报告 + diff stat → 用户确认」。保留 ★ 用户参与点，但人工劳动从「逐项核对」降为「看报告拍板」。

## Capabilities

### New Capabilities
- `harness-acceptance`: 基于 httpClient 的通用验收机制——三层断言（静态检查、端点可达性烟测、change 级定制）+ 结构化报告 + 环境隔离的共享测试 helper。

### Modified Capabilities
- `harness-pipeline`（隐含）：步骤 6 验收从纯人工升级为「httpClient 驱动 + 人工最终确认」。

## Impact

- `.opencode/skills/opsx-accept/SKILL.md` — 新增 skill 文档（约 150 行）
- `.opencode/skills/harness/SKILL.md` — 修改步骤 6 章节（line 203-230）
- `tests/helpers/real-server.ts` — 新增共享 helper（提取 createRealServer + 环境隔离）
- `tests/team-e2e-llm.test.ts` — 改为 import 共享 helper（消除 copy-paste）
- `tests/acceptance-smoke.test.ts` — 新增烟测脚本（约 100 行，默认 skip）
- `src/server/http.ts` — `HttpServerOptions` 加可选 `host?: string` 字段，`createHttpServer` 据此调用 `httpServer.listen(port, host)`（最小变更，4 行，向后兼容；修复 Oracle 识别的"绑定所有接口"安全问题）
- 无其他 src/ 代码变更（复用现有 HttpClient / AgentServer / SSE / JSONL 基础设施）
- 无破坏性变更：harness 步骤 6 仍保留用户确认，只是确认前多了自动验收报告

## Non-goals

- **不做全自动合并**：验收通过后仍需用户拍板才 merge 到 main。全自动合并是后续可配置项，不在本次范围。
- **不重写 team-verify**：team-verify 继续作为 Team 模式专用验收 skill，`opsx-accept` 是面向任意 change 的通用 skill，两者并存。
- **不新增 HTTP 端点**：复用现有 `/session/id`、`/model`、`/messages`、`/events`、`/prompt`、`/sessions` 端点。
- **不做验收 DSL 或框架**：用 markdown（change 级断言）+ bun test（烟测）即可，不引入新抽象。
- **不做性能/压力测试**：烟测只验证 GET 端点可达性 + SSE 订阅建立（不调 `/prompt`）。
- **不修改 OpenSpec CLI**：`acceptance.md` 约定是文档级的，不改 `openspec` 命令。
