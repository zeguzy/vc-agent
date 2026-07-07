# Tasks: team-discussion-e2e

## 1. HTTP 链路透传 type 字段

- [x]1.1 `src/client/types.ts`: 在现有 `import type { ... } from "../teams/types-v2.js"` 块（行 6-14）加 `TaskType`；`AgentClient.assignTask` 签名加 `type?: TaskType`
- [x]1.2 `src/server/index.ts`: `handleAssignTask` 签名加 `type?: TaskType`，透传给 `teamManager.assignTask`
- [x]1.3 `src/server/http.ts`: `POST /team/tasks` readBody 类型加 `type?: "execution" | "discussion"`，传入 `handleAssignTask(body)`
- [x]1.4 `src/server/http.ts` 或 `src/server/index.ts`: 校验传入的 `type` ∈ `{"execution", "discussion", undefined}`，非法值（如 `"unknown"` / 数字）返回 400 `{error: "invalid type"}`
- [x]1.5 `src/client/http.ts`: `HttpClient.assignTask` 已透传 opts 到 postJson（用 `Parameters<AgentClient["assignTask"]>[0]` 推导），接口改后自动跟随，无需改实现；新增一个回归测试断言 type 出现在 request body
- [x]1.6 `src/client/in-process.ts`: `InProcessClient.assignTask` 用内联签名，手动加 `type?: TaskType` 并透传 `opts.type` 给 `server.handleAssignTask`

## 2. Coordinator 纯函数单元测试

- [x]2.1 新建 `tests/team-discussion-unit.test.ts`：import `parseCoordinatorDecision`、`buildCoordinatorPrompt`、`collectRecentMessages` from `../src/teams/coordinator.js`
- [x]2.2 `parseCoordinatorDecision` 用例：markdown 包裹 JSON / 纯 JSON / 非法 JSON / 缺 nextSpeaker / 缺 instruction / 未知 action
- [x]2.3 `buildCoordinatorPrompt` 用例：含 task title/description/priority、每个 member name+role、round/maxRounds、recent messages 截断到 200 字符、含 JSON 响应格式说明
- [x]2.4 `collectRecentMessages` 用例：多 member inbox.jsonl 合并、按 timestamp 升序、去重（相同 from+to+timestamp）、limit 截断、缺失文件 no throw

## 3. evaluateDiscussion 集成测试（mock session，无 LLM）

- [x]3.1 在 `tests/team-discussion-unit.test.ts` 加 describe block：构造 TeamManager + 3 个 mock member（参考 `team-messages-e2e.test.ts` 的 `injectMember` + `fakeSession`）
- [x]3.2 在测试文件**顶层**（所有 import 之前）用 `bun:test` 的 `mock.module("../src/teams/coordinator.js", ...)` 替换 `runCoordinator` 返回可控决策；若 bun 版本时序 flake，回退为手工构造 evaluateDiscussion 所需的 `this.files` / `this.members` / `this.services` 状态
- [x]3.3 continue 分支：mock runCoordinator 返回 `{action:"continue", nextSpeaker:"alice", instruction:"...", reason:"..."}` → 用 `@ts-expect-error` 直调 `(manager as any).evaluateDiscussion(task)` → 断言 alice 的 `session.steer` 或 `session.prompt` 被调用（与 team-messages-e2e.test.ts L98 `injectMember` 的 `@ts-expect-error` 模式一致）
- [x]3.4 complete 分支：mock runCoordinator 返回 `{action:"complete", reason:"consensus reached"}` → 用 `@ts-expect-error` 直调 `(manager as any).evaluateDiscussion(task)` → 断言 `completeTask` 被调用、task.done === true、`(manager as any).discussionRound.has(task.id) === false`

## 4. Discussion E2E 测试（真 LLM，默认 skip）

- [x]4.1 新建 `tests/team-discussion-e2e.test.ts`：`describe.skipIf(process.env.RUN_LLM_TESTS !== "1")`，复用 `createRealServer` + `createHttpServer` + `HttpClient`
- [x]4.2 beforeAll：启动 server，记录 baseUrl，新建 HttpClient 并 init
- [x]4.3 用例 1 — discussion 任务完成：`client.createMember` × 3（alice/bob/carol，带 message 工具）→ `client.assignTask({type:"discussion"})` → 断言返回 task.type === "discussion" + status in_progress
- [x]4.4 用例 1 续：轮询 `client.fetchTaskStatus(taskId)` 直至 done（180s deadline），断言 in_progress → done 流转
- [x]4.5 用例 2 — 成员交流：fetchMembers + fetchInbox 至少 1 个 member inbox 含来自其他 member 的消息
- [x]4.6 用例 3 — coordinator 决策日志：读 `~/.config/openagent/logs/teams/<date>.jsonl`，断言至少 1 个 `discussion_evaluated` 事件含 taskId/round/action/reason
- [x]4.7 用例 4 — member 状态循环：轮询期间至少 1 个 member 的 status 经历过 active → idle → active 或停在 idle
- [x]4.8 afterAll：cancel 所有 member + close httpServer + restoreHome

## 5. acceptance.md

- [x]5.1 新建 `openspec/changes/team-discussion-e2e/acceptance.md`
- [x]5.2 Smoke 段：`bun test tests/team-discussion-unit.test.ts` 应全 PASS；`ACCEPTANCE_SMOKE=1 bun test tests/acceptance-smoke.test.ts` 应全 PASS
- [x]5.3 Manual QA 段：HttpClient `assignTask({type:"discussion"})` 返回 TaskState.type === "discussion"；不传 type 返回 type === "execution"
- [x]5.4 Log Assertions 段：`RUN_LLM_TESTS=1` 跑 discussion E2E 后 JSONL 日志含 `discussion_evaluated` 事件

## 6. 验证

- [x]6.1 worktree 内 `bun install`（若网络允许；失败则在主目录跑测试）
- [x]6.2 `bun run check` 全绿（typecheck + lint + test，含新单元测试）
- [ ] 6.3 `RUN_LLM_TESTS=1 bun test tests/team-discussion-e2e.test.ts`（用户环境验证，需 LLM 配置）
