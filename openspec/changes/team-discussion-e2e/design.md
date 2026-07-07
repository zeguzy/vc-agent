## Context

Team 模式的 discussion 任务类型在 `TeamManager.assignTask`（`src/teams/manager-v2.ts:447`）内部已完整支持 `type?: TaskType`（默认 `execution`），discussion 执行路径 `evaluateDiscussion`（L609-667）+ member 完成回调（L1149-1171）也已实现，coordinator（`src/teams/coordinator.ts`）能驱动多轮发言。

但 HTTP 链路三层透传断开：

```
HttpClient.assignTask       (src/client/http.ts:249)
        ↓ opts: Parameters<AgentClient["assignTask"]>[0]
AgentClient.assignTask      (src/client/types.ts:97)   ← 签名无 type
        ↓
POST /team/tasks            (src/server/http.ts:153)   ← readBody 无 type
        ↓
handleAssignTask            (src/server/index.ts:365)  ← 签名无 type
        ↓
TeamManager.assignTask      (src/teams/manager-v2.ts:447) ← 内部支持 type，永远拿不到
```

结果：任何 HTTP/客户端调用方都创建不出 discussion 任务，导致：
- coordinator 决策路径（continue/complete）零测试覆盖
- discussion task 状态流转（in_progress → done）零 E2E 覆盖
- 成员间消息驱动讨论推进零 E2E 覆盖
- leader 视角等待语义零验证

## Goals / Non-Goals

**Goals**:
- 让 `HttpClient.assignTask({type:"discussion"})` 能完整创建并跑通 discussion 任务
- 补 coordinator 纯函数单元测试（默认运行，无 LLM 依赖）
- 补 discussion 任务 E2E 测试（默认 skip，`RUN_LLM_TESTS=1` 启用，复用 `createRealServer` + `HttpClient` 模式）
- 提供 `acceptance.md` 供 `/opsx-accept` 自动验收

**Non-Goals**:
- 不改 discussion 执行内部逻辑（`evaluateDiscussion` / `DISCUSSION_MAX_ROUNDS` / coordinator prompt）
- 不增加 leader 显式"等待"API（语义通过 task status 查询 + 日志断言验证）
- 不改 `src/tools/team.ts` leader agent 工具（测试以 HttpClient 直接驱动）
- 不补 `team-v2-http-api` spec 里 `memberId` vs 代码 `memberName` 的历史 drift
- 不增加 SSE 新事件类型或 discussion 完成回调

## Decisions

### D1: 扩展 `assignTask` type 字段（5 处透传），不新增端点

**选择**: 在现有 `POST /team/tasks` 端点 + `assignTask` 客户端方法上增加可选 `type?: "execution" | "discussion"` 字段。

**备选方案**:
- (A) 新增 `POST /team/discussions` 高层端点 —— 语义清晰但侵入大，需复制 member 创建 + task 分配 + 协调启动三段逻辑
- (B) 通过 team 工具 prompt 触发（leader agent 说"创建讨论"）—— 不改 API，但 E2E 测试要靠 LLM 调对工具，引入 LLM 不确定性
- (C) **扩 type 字段（采纳）** —— 5 处机械改动，零破坏（默认 execution），最小化侵入

**理由**: 内部 manager 已支持 type，只是链路没透传。扩字段是对内部能力的对外暴露，不是新功能。与现有 V2 HTTP API 风格一致。

### D2: 单元测试边界 = coordinator 纯函数 + evaluateDiscussion 集成（mock session）

**选择**: `tests/team-discussion-unit.test.ts` 覆盖：

| 被测对象 | 测试内容 | 是否需 LLM |
|---------|---------|-----------|
| `parseCoordinatorDecision` | 各种 JSON 格式（markdown 包裹、纯 JSON、非法 JSON、缺字段） | 否 |
| `buildCoordinatorPrompt` | 输出含 task/members/messages/round，含决策指南 | 否 |
| `collectRecentMessages` | 多 member inbox 合并、去重、按 timestamp 排序、limit 截断 | 否 |
| `evaluateDiscussion` continue 分支 | mock runCoordinator 返回 continue → 验证 nextSpeaker 被 steer/prompt 唤醒 | 否（mock） |
| `evaluateDiscussion` complete 分支 | mock runCoordinator 返回 complete → 验证 completeTask 被调用、状态正确 | 否（mock） |

**理由**: 这些是 discussion 协调的纯逻辑，不依赖 LLM 即可锁定行为。`evaluateDiscussion` 集成测试用 mock session + mock coordinator 模块，能在毫秒级验证状态机。

### D3: E2E 测试模式 = `createRealServer` + `HttpClient` + JSONL 日志断言

**选择**: `tests/team-discussion-e2e.test.ts` 复用 `tests/helpers/real-server.ts` + `HttpClient` 类（与 `acceptance-smoke.test.ts` 模式一致），不裸用 `fetch`。

```
┌─────────────────────────────────────────────────────────────────┐
│  tests/team-discussion-e2e.test.ts                              │
│                                                                  │
│  ┌──────────────────┐   ┌────────────────────────────────────┐  │
│  │ createRealServer │──▶│ AgentServer (真 runtime/LLM)        │  │
│  └──────────────────┘   │   ↓                                │  │
│         ↓               │ TeamManager (真 coordinator + LLM)  │  │
│  ┌──────────────────┐   │   ↓                                │  │
│  │ createHttpServer │──▶│ HttpServer port:0 127.0.0.1        │  │
│  └──────────────────┘   └────────────────────────────────────┘  │
│         ↓                                                       │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ HttpClient (项目 src/client/http.ts)                     │  │
│  │   .createMember × 3                                      │  │
│  │   .assignTask({type:"discussion", memberName, ...})      │  │
│  │   .fetchMembers() / .fetchTasks() / .fetchInbox()        │  │
│  └──────────────────────────────────────────────────────────┘  │
│         ↓                                                       │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ 断言                                                       │  │
│  │   1. 至少 1 次成员间消息交换（fetchInbox 非空）             │  │
│  │   2. 至少 1 次 coordinator 决策（JSONL 含 discussion_evaluated） │
│  │   3. task status 最终为 done（in_progress → done）         │  │
│  │   4. 至少 1 个 member 状态经历过 active → idle 循环        │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

**断言策略**: 不验证 LLM 输出内容质量，只验证结构性断言（消息存在、事件到达、状态转换）。这与 `team-verify` skill 的护栏一致。

### D4: 不加新日志事件，复用现有 `discussion_evaluated`

**选择**: 现有 `logTeamEvent("discussion_evaluated", {taskId, round, action, reason})`（`manager-v2.ts:637`）已足够 E2E 断言 coordinator 决策次数和动作类型。不加 `discussion_started` / `discussion_completed` 新事件。

**理由**: 减少改动面。discussion 生命周期边界可通过 `task_assigned`（开始）+ `task_completed`（结束）+ 中间的 `discussion_evaluated` 推导。

### D5: E2E 默认 skip，门控环境变量 `RUN_LLM_TESTS=1`

**选择**: 与 `tests/team-e2e-llm.test.ts` 一致，`describe.skipIf(process.env.RUN_LLM_TESTS !== "1")`。不引入新环境变量。

**理由**: 真 LLM 测试消耗 token + 慢（90-180s/用例），不能进 `bun run check` 默认路径。

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| `assignTask` type 字段对老客户端零感知，但若老客户端误传 `type:"discussion"` 会被当 discussion 任务执行（member 不会进入 done，而是 idle + 触发 coordinator） | type 字段可选 + 默认 execution；现有调用方不传 type 即可。文档明确说明 discussion 任务的语义差异 |
| E2E 真 LLM 调用有 flake 风险（coordinator 决策不确定、member 发言轮数不定） | 只做结构性断言（事件到达、状态转换、消息存在），不断言具体内容或轮数。设置 180s 超时 + `DISCUSSION_MAX_ROUNDS=10` 兜底 |
| `evaluateDiscussion` 是 `TeamManager` 私有方法，单元测试无法直接调用 | 用 `@ts-expect-error` 直调 `(manager as any).evaluateDiscussion(task)` 最简单可控（参考 `team-messages-e2e.test.ts` L98 `injectMember` 已用此模式）。配合 `mock.module("../src/teams/coordinator.js", ...)` 在测试文件顶层（所有 import 之前）替换 `runCoordinator` 返回可控决策。若 bun mock.module 时序 flake，回退为手工构造 evaluateDiscussion 所需的 `this.files` / `this.members` / `this.services` 状态 |
| `coordinator.ts` 的 `collectRecentMessages` 直接读文件系统（inbox.jsonl），测试要在临时目录构造 fixture | 用 `mkdtempSync` 隔离 + 手工写 inbox.jsonl 文件，参考 `team-messages-e2e.test.ts` 模式 |
| worktree `bun install` 网络失败（用户环境） | 测试代码可在主目录跑（共享 node_modules 软链或重试 install）。install 是 user-only 环境问题，不阻断提案 |

## Migration Plan

无需迁移。type 字段可选，默认 execution，对现有调用方零破坏。

回滚策略：单 commit revert 即可，无数据/schema 变更。
