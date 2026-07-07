## Smoke

- `bun run check` 应全绿（typecheck + lint + test），新测试 `team-discussion-unit.test.ts`（25 用例）和 `team-discussion-integration.test.ts`（6 用例）默认运行，`team-discussion-e2e.test.ts` 默认 skip 不影响
- `ACCEPTANCE_SMOKE=1 bun test tests/acceptance-smoke.test.ts` 应全 PASS（HttpClient + 真实 server 端点可达性烟测未被本 change 破坏）
- `RUN_LLM_TESTS=1 bun test tests/team-discussion-e2e.test.ts` 应全 PASS（若环境有可用 LLM 配置 + 网络）；若 LLM 未配置或网络受限，标注 SKIP 并说明原因
- 验证 HTTP 链路 type 字段已透传：
  ```bash
  bun -e "const s = await Bun.file('./src/client/types.ts').text(); console.log(s.includes('type?: TaskType'))"
  ```
  应输出 `true`
- 验证 server 端校验非法 type：
  ```bash
  bun -e "const s = await Bun.file('./src/server/http.ts').text(); console.log(s.includes('invalid type'))"
  ```
  应输出 `true`

## Manual QA

- 阅读 `src/client/types.ts`：`AgentClient.assignTask` 签名应含 `type?: TaskType`
- 阅读 `src/server/index.ts`：`handleAssignTask` 签名应含 `type?: TaskType`
- 阅读 `src/server/http.ts`：`POST /team/tasks` readBody 应接收 `type?: "execution" | "discussion"`，非法值返回 400
- 阅读 `src/client/in-process.ts`：`InProcessClient.assignTask` 应透传 `opts.type`
- 阅读 `tests/team-discussion-unit.test.ts`：应覆盖 `parseCoordinatorDecision`（10 用例）、`buildCoordinatorPrompt`（6 用例）、`collectRecentMessages`（9 用例）
- 阅读 `tests/team-discussion-integration.test.ts`：应覆盖 `evaluateDiscussion` continue/complete/speaker-unavailable 分支（6 用例），用 `mock.module` 替换 coordinator + `@ts-expect-error` 直调 private 方法
- 阅读 `tests/team-discussion-e2e.test.ts`：应用 `describe.skipIf(process.env.RUN_LLM_TESTS !== "1")`，复用 `createRealServer` + `HttpClient` 类（不用裸 fetch）

## Log Assertions

- `RUN_LLM_TESTS=1 bun test tests/team-discussion-e2e.test.ts` 跑完后，`~/.config/openagent/logs/teams/<date>.jsonl` 应含 `event: "discussion_evaluated"` 条目（至少 1 个），每条应包含字段：
  - `taskId`: 字符串，与创建的 discussion task id 一致
  - `round`: 数字，> 0，单 task 内单调递增
  - `action`: `"continue"` 或 `"complete"`
  - `reason`: 字符串
- 同一次跑还应含 `event: "task_assigned"`（任务创建时）和 `event: "task_completed"` 或 `event: "member_done"`（任务/成员状态变更时）
- 注意：日志由 `src/teams/logger.ts` 写入，`LOG_DIR` 在模块加载时固化到当时的 `homedir()`，因此即使 `createRealServer` 隔离了 `process.env.HOME`，日志仍写入真实 HOME。这是已知 trade-off，不在本 change 修复范围
