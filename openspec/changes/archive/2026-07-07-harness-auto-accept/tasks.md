## 1. 共享测试 helper + 通用烟测脚本

- [x] 1.1 创建 `tests/helpers/real-server.ts`，从 `tests/team-e2e-llm.test.ts` 提取 `createRealServer()` 为导出函数 `createRealServer(opts?: { cwd?: string }): Promise<{ server, runtime, skillManager, restoreHome: () => void }>`，加三项环境隔离：① 临时 HOME（`os.tmpdir()/openagent-test-<pid>-<rand>/`，写入 `process.env.HOME` 并返回 restore 函数）② 返回 host 信息便于绑定 ③ cwd 默认 `process.cwd()`
- [x] 1.2 改 `tests/team-e2e-llm.test.ts` 从 helper import `createRealServer`（消除 copy-paste），保留原有测试逻辑不变
- [x] 1.3 创建 `tests/acceptance-smoke.test.ts`，搭建 `describe.skip("Acceptance Smoke")` 套件（用 `ACCEPTANCE_SMOKE=1` 启用），beforeAll 调用 `createRealServer()` + `createHttpServer({server, port:0, host:"127.0.0.1"})`，通过 `httpServer.address().port` 拿端口
- [x] 1.4 编写「server 启动 + 端口获取」用例：断言 `httpServer.address().port > 0`，`baseUrl = http://127.0.0.1:<port>` 可达（fetch 不抛错）
- [x] 1.5 编写「核心 GET 端点烟测」用例：fetch GET `/session/id`、`/model`、`/messages`、`/sessions` 全部返回 200，body 含预期字段（如 `/session/id` body 含 `id` 字段）
- [x] 1.6 编写「SSE /events 订阅建立 + abort 端点存在性」用例：fetch `/events` 建立 SSE 流（`Accept: text/event-stream`），等 500ms 确认连接建立（不强制要求收到事件，因不触发 agent turn 无事件），5s 超时记 SKIP；同时验证 `POST /abort` 端点返回 200（验证路由存在）
- [x] 1.7 设置每用例 30s 超时，afterAll 关闭 httpServer + `server.handleCancelAllWorkers()` 清理 + 调用 `restoreHome()` 还原 `process.env.HOME`
- [x] 1.8 确认 `bun run check`（无 `ACCEPTANCE_SMOKE`）时整套烟测被 skip，不影响常规 check

## 2. `opsx-accept` skill 文档

- [x] 2.1 创建 `.opencode/skills/opsx-accept/SKILL.md`，frontmatter（name/description/license/metadata.version:"1.0"）
- [x] 2.2 写「触发条件」段落：harness 步骤 6 自动调用；用户显式 `/opsx-accept`；用户说「验收」「accept」「跑验收」
- [x] 2.3 写「三层验收」流程段落：Layer 0 (`bun run check`) → Layer 1 (`ACCEPTANCE_SMOKE=1 bun test tests/acceptance-smoke.test.ts`) → Layer 2 (`openspec/changes/<active>/acceptance.md` 若存在)
- [x] 2.4 写「change 级定制断言」约定段落：说明 acceptance.md 的三段结构（Smoke/Manual QA/Log Assertions），给示例；明确 Log Assertions 段对 team change 用于查 JSONL，非 team change 该段空
- [x] 2.5 写「汇总报告」模板：包含每层 PASS/FAIL/SKIP 状态、失败详情、diff stat（`git diff --stat main..<branch>`）、worktree 路径、change 名称、最终判定（PASS/FAIL）
- [x] 2.6 写「API 参考」段落：列出烟测会用到的 HTTP 端点（GET /session/id、GET /model、GET /messages、GET /sessions、GET /events SSE、POST /abort 存在性）
- [x] 2.7 写「护栏」段落：Layer 1 默认 skip；**不调 `/prompt`**（会阻塞 + 消耗 token）；SSE 5s 超时；保留用户最终确认；与 team-verify 边界（team change 优先 team-verify，本 skill 通用）

## 3. 修改 harness SKILL.md 步骤 6

- [x] 3.1 定位 `.opencode/skills/harness/SKILL.md` line 203-230（步骤 6 验收章节）
- [x] 3.2 把「展示变更摘要 + 等待用户确认」改为「调用 `/opsx-accept` 跑三层自动验收 → 收集报告」
- [x] 3.3 更新展示模板：加入「自动验收结果」段（Layer 0/1/2 状态 + 失败详情），保留「变更摘要 / 完成任务 / diff stat / worktree 路径」
- [x] 3.4 明确流转规则：自动验收 Layer 0 必过 + Layer 1/2 看情况 → 全 PASS（或 Layer 1/2 SKIP）展示报告请求用户确认；Layer 0 FAIL 必回步骤 4
- [x] 3.5 在「自动流转规则」表格（line 269-277）更新「验收→合并清理」行：触发条件改为「自动验收通过 + 用户确认」，标注 ★ 仍保留
- [x] 3.6 在「护栏」段落（line 302-311）补一条：「自动验收不替代用户确认——验收通过仅减少核对劳动，不取消人工把关」
- [x] 3.7 更新 SKILL.md 顶部 `metadata.version` 1.3 → 1.4

## 4. 编写本 change 自身的 acceptance.md（dogfooding）

- [x] 4.1 创建 `openspec/changes/harness-auto-accept/acceptance.md`
- [x] 4.2 写 Smoke 段：`ACCEPTANCE_SMOKE=1 bun test tests/acceptance-smoke.test.ts` 应全 PASS（若环境支持 bun install）；`bun run check` 应全绿（smoke 套件 skip）
- [x] 4.3 写 Manual QA 段：阅读 `.opencode/skills/opsx-accept/SKILL.md` 触发条件应能被识别；harness SKILL.md 步骤 6 应调用 /opsx-accept；`tests/helpers/real-server.ts` 应被 team-e2e-llm.test.ts 和 acceptance-smoke.test.ts 共享
- [x] 4.4 写 Log Assertions 段：N/A（本 change 不改 team 日志系统，该段空）

## 5. 验证与收尾

- [x] 5.1 运行 `bun run check`（typecheck + lint + test）确认全绿（acceptance-smoke 默认 skip 不影响）
- [x] 5.2 若环境允许，运行 `ACCEPTANCE_SMOKE=1 bun test tests/acceptance-smoke.test.ts` 确认烟测可跑；环境不允许则在报告标注 SKIP 并说明
- [x] 5.3 跑 `/opsx-accept` 自验收：执行本 change 的 acceptance.md，确认三层验收产出预期报告
- [x] 5.4 git diff review，确认改动面与 proposal Impact 段一致
