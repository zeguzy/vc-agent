## Context

`src/tools/team.ts` 的 `team` 工具目前以 `action="assign"` 单任务、`action="direct"` 单消息方式工作。Leader agent 给 N 个成员派任务或发消息需要 N 次工具调用 = N 轮 LLM round-trip。

`TeamManager.assignTask`（同步）和 `directMember`（同步 void）是单条接口：

- `assignTask({ title, description, memberName, priority })` → `TaskState`：成员不存在或非 idle 时抛错
- `directMember(name, kind, payload)`：`kind ∈ {directive, context, redirect}`；`redirect` 会改成员优先级；成员不存在时抛错

本设计不动这两个接口——批量逻辑全部放在 tool 层，与 `create-batch`（2026-07-06）完全对称。

```
现状（给 3 个成员派任务）:

  Leader ──▶ LLM ──▶ team(assign,t1) ──▶ LLM ──▶ team(assign,t2) ──▶ LLM ──▶ team(assign,t3)
       round1         round2                     round3                     round4
  <────────────────────── 4 轮 round-trip ──────────────────────>

assign-batch 后:

  Leader ──▶ LLM ──▶ team(assign-batch, [t1,t2,t3]) ──▶ LLM
       round1         round2                            round3
  <────────── 3 轮 round-trip ──────────>

  （direct 同理）
```

## Goals / Non-Goals

**Goals:**

- 把「给 N 个成员派任务」和「给 N 个成员发消息」各压缩成 1 次工具调用
- 与现有 `assign` / `direct` 单条语义保持一致
- per-item 失败有清晰、可恢复的反馈
- `direct` 批量对同一成员的多条 `redirect` 保证确定语义（后覆盖前）

**Non-Goals:**

- 不改 `assignTask` / `directMember` 接口
- 不引入事务、不回滚
- 不并行（`direct` 的 `redirect` 必须串行）
- 不改程序化 API

## Decisions

### D1：新增独立 action（assign-batch / direct-batch）而非扩展单条 action

**选择**：新增两个独立 action。

**理由**：与 `create-batch` D1 完全一致——`assign` 已有 name/title/description/priority 一组单任务参数，若同时接受 `tasks` 数组会形成互斥分支，schema 复杂、prompt 模糊。独立 action 让 schema 单一职责。

**备选**：扩展 `assign` / `direct` 同时支持单/多模式。**否决**——互斥参数增加 LLM 误用率，且与既有 `create` / `create-batch` 模式不一致。

### D2：数组项 schema 与单条字段一一对应

```
tasks: Array<{           // assign-batch
  name: string           // 必填 — 目标成员
  title: string          // 必填 — 任务标题
  description?: string   // 可选
  priority?: "high"|"medium"|"low"
}>

messages: Array<{        // direct-batch
  name: string           // 必填 — 目标成员
  kind: "directive"|"context"|"redirect"  // 必填
  payload: string        // 必填 — 消息内容
}>
```

**理由**：与 `handleAssign` / `handleDirect` 现有字段对齐，leader 不需要在两种调用间切换心智模型。

### D3：单态失败语义 —— 区别于 create 的两态

`create-batch` 有 createMember + assignTask 两步，产生「成员创建成功但任务失败」的中间态（归 succeeded 带 warn）。`assign-batch` 和 `direct-batch` 各只有单步操作：

```
for (const item of items):
  try { manager.assignTask(...) 或 manager.directMember(...) }
  catch → failed.push({name, error: msg}); continue
  ok   → succeeded.push({name, ...})
```

**无容量预检**：assign / direct 针对已存在成员，不涉及 `maxWorkers`，不需要入口整批拒绝。失败原因只有「成员不存在」或「成员非 idle（assign 场景）」，是个体问题，per-item 隔离即可。

### D4：direct 串行覆盖语义 —— 同成员多 redirect 后覆盖前

`directMember(name, "redirect", payload)` 会向成员注入 `[Leader Redirect]` 消息，成员据此调整行为焦点（manager 层不修改任何「优先级」字段，而是通过 prompt 内容影响成员 LLM 的后续决策）。若同一批 `messages` 里对同一成员发多条 `redirect`：

```
messages: [
  { name: "sasha", kind: "redirect", payload: "优先做 A" },
  { name: "sasha", kind: "redirect", payload: "优先做 B" },
]
```

**选择**：按数组顺序串行应用，后一条覆盖前一条。最终 sasha 的焦点是 B。

**理由**：

- 与 create-batch 的顺序循环一致，无并发
- 「后覆盖前」是数组顺序的自然语义，调用方完全可控
- 不做冲突检测/拒绝：批量场景下 leader 可能有意覆盖（先设默认再修正），拒绝会限制表达力
- 调用方若担心冲突，自行控制数组内容即可

### D5：独立软上限常量

新增 `ASSIGN_BATCH_SOFT_LIMIT = 20` 和 `DIRECT_BATCH_SOFT_LIMIT = 20`，与现有 `CREATE_BATCH_SOFT_LIMIT = 20` 对称。

**不复用一个共享常量的理由**：

- 三个 action 的上限语义独立——未来可能 `direct` 因 redirect 副作用需要更小上限
- create-batch 的 design D5 已指出「20 是经验值，可在 design 评审时调整」，暗示 per-action 可调
- 共享常量需要重命名 `CREATE_BATCH_SOFT_LIMIT`，破坏现有测试 import，收益不抵成本

### D6：报告格式规范（固定逐行格式）

与 create-batch D6 风格一致，两桶分组：

**assign-batch:**

```
Assigned 3 task(s):
  ✓ T1 "Login validation" → @sasha
  ✓ T2 "API schema" → @marcus
Failed 1 task(s):
  ✗ @kim: member not found
```

**direct-batch:**

```
Sent 3 message(s):
  ✓ @sasha [context]: The design file is at /docs/mockup.fig
  ✓ @marcus [directive]: Switch to JWT auth
Failed 1 message(s):
  ✗ @kim: member not found
```

格式规则：

- 成功行以 `✓ ` 开头，失败行以 `✗ ` 开头
- assign 成功行：`<taskId> "<title>" → @<name>`
- direct 成功行：`@<name> [<kind>]: <payload>`（payload 过长时截断到 60 字符 + `…`；完整 payload 已投递给成员，报告只做摘要）
- 失败行：`@<name>: <error message>`
- 桶标题复数变体：`1 task` / `2 task(s)`
- 任一成功即 `isError = false`；全失败 `isError = true`

## Risks / Trade-offs

- **[assignTask 内部多步写的非原子性（pre-existing）]** → `TeamManager.assignTask`（`manager-v2.ts:436-489`）内部依次写 TEAM.md → member.md → 内存状态 → prompt 注入，非单步原子；理论上 writeTeamMd 成功后 writeMemberIndex 抛错会留下不一致。这是 **TeamManager 既有实现**（create-batch 同处境），本变更不在 scope 内修复。tool 层 per-item try/catch 已覆盖「调用级失败」（任何步骤抛错 → 该 task 归 failed 桶，不影响其他项）；实践中本地文件 I/O 失败极少。
- **[redirect 批量覆盖语义易误用]** → design D4 明确「后覆盖前」；description 文本里给出示例提示 leader 同成员多 redirect 的覆盖顺序。不做静默合并或拒绝——保持工具可预测。
- **[payload 过长导致结果文本膨胀]** → direct 的 payload 可能很长，报告里截断到 60 字符 + `…`；完整 payload 已投递给成员，报告只做摘要。
- **[与未来程序化批量 API 重复]** → 当前程序化 API 无批量诉求；若未来出现，抽公共函数复用，不在本期。

## Migration Plan

- **部署**：纯新增 action + 可选参数，无 breaking change，无需迁移。
- **回滚**：移除两个 batch 分支与对应 schema 字段即可完整回滚；`assign` / `direct` 行为完全不变。

## Open Questions

无。所有边界已在 Decisions 中明确。
