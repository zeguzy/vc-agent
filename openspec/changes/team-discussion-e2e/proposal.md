## Why

Team 模式有 `execution` 和 `discussion` 两种任务类型（`src/teams/types-v2.ts:50`），discussion 由 coordinator（`src/teams/coordinator.ts`）驱动多轮成员发言 + 状态流转（`manager-v2.ts:605-667`、`1149-1171`），是 leader 协调成员协作的核心能力。但**整个 HTTP/HttpClient 链路无法创建 discussion 任务**：`AgentClient.assignTask`（`src/client/types.ts:97`）、`handleAssignTask`（`src/server/index.ts:365`）、`POST /team/tasks` body（`src/server/http.ts:153`）三层都缺 `type` 字段，导致 `HttpClient.assignTask()` 永远创建 `execution` 任务。

结果：discussion 任务**零 E2E 覆盖**，coordinator 决策（continue/complete）、成员间消息驱动讨论推进、discussion task 状态流转（in_progress → done）、leader 视角等待 discussion 完成等关键行为全部未验证。当前 `tests/team-e2e-llm.test.ts` 整体 `describe.skip` 且仅覆盖 execution 任务。

## What Changes

- 扩展 `assignTask` HTTP 链路支持 `type?: "execution" | "discussion"` 字段（默认 execution，向后兼容）
- 新增 `tests/team-discussion-unit.test.ts`：coordinator 纯函数单元测试（`parseCoordinatorDecision` / `buildCoordinatorPrompt` / `collectRecentMessages`），无需 LLM，默认运行
- 新增 `tests/team-discussion-e2e.test.ts`：真 LLM 端到端，3 member × `DISCUSSION_MAX_ROUNDS` 上限，复用 `createRealServer` + `HttpClient` 类 + JSONL 日志断言，默认 skip（`RUN_LLM_TESTS=1` 启用）
- 新增 `acceptance.md`：三段结构（Smoke / Manual QA / Log Assertions），供 `/opsx-accept` 自动验收

## Capabilities

### New Capabilities

无。本 change 复用现有 team 协调实现，仅暴露已被内部支持但未对外公开的能力。

### Modified Capabilities

- `team-v2-http-api`: `assignTask` HTTP API 新增可选 `type` 字段，调用方可显式创建 discussion 任务
- `team-e2e-test`: E2E 测试套件新增 discussion 任务生命周期覆盖（创建 → coordinator 决策 → 成员交流 → 状态流转 → 完成）

## Impact

**改动文件**（HTTP 链路透传 type，5 处机械改动）：
- `src/client/types.ts` — `AgentClient.assignTask` 签名加 `type?: TaskType`
- `src/client/http.ts` — `HttpClient.assignTask` 透传 type
- `src/client/in-process.ts` — `InProcessClient.assignTask` 透传 type
- `src/server/index.ts` — `handleAssignTask` 签名加 `type?`
- `src/server/http.ts` — `POST /team/tasks` readBody 接收 type

**新增文件**：
- `tests/team-discussion-unit.test.ts` — coordinator 单元测试（默认运行）
- `tests/team-discussion-e2e.test.ts` — 真 LLM E2E（默认 skip）
- `openspec/changes/team-discussion-e2e/acceptance.md`

**Spec delta**：
- `specs/team-v2-http-api/spec.md` delta — `assignTask` 场景加 type 参数
- `specs/team-e2e-test/spec.md` delta — 新增 discussion E2E requirement

**依赖与风险**：
- 不引入新依赖
- type 字段可选 + 默认 execution，对现有调用方零破坏
- 真 LLM E2E 消耗 token：3 member 各 1-N turn + coordinator 每轮 1 次，受 `DISCUSSION_MAX_ROUNDS=10` 兜底，单测超时 180s

## Non-goals

- 不改 `src/teams/manager-v2.ts` 内部 discussion 执行逻辑（`evaluateDiscussion` / `discussionRound` / `DISCUSSION_MAX_ROUNDS`）—— 已实现，仅测试
- 不改 `src/teams/coordinator.ts` 的 prompt 构造和 LLM 调用逻辑—— 已实现，仅测试
- 不改 `src/tools/team.ts` 工具—— 不给 leader agent 增加 discussion 触发语法（测试直接调 HttpClient API）
- 不补 `team-v2-http-api` spec 里 `memberId` vs 代码 `memberName` 的历史 drift（out of scope）
- 不增加 discussion 完成回调、webhook、SSE 新事件类型
- 不增加 leader 视角的"等待"显式 API—— leader 等待语义通过 task status 查询 + 日志断言验证
- 不改 `DISCUSSION_MAX_ROUNDS` 常量值（保持 10）
