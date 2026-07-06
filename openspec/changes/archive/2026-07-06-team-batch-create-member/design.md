## Context

`src/tools/team.ts` 的 `team` 工具目前以 `action="create"` 单成员方式创建成员，每次只产生一个 member。Leader agent 组建 N 人团队需要 N 次工具调用 = N 轮 LLM round-trip。`TeamManager.createMember`（`src/teams/manager-v2.ts:67`）是单条同步接口，内部含 `maxWorkers` 容量检查、`members.has(name)` 重名检查、`validateName` 校验、session 创建与 `TEAM.md` 更新，本设计不动它——批量逻辑全部放在 tool 层。

```
现状（N=3 时）:

  Leader ──▶ LLM ──▶ team(create,m1) ──▶ LLM ──▶ team(create,m2) ──▶ LLM ──▶ team(create,m3)
       round1         round2                     round3                     round4
  <────────────────────── 4 轮 round-trip ──────────────────────>
```

## Goals / Non-Goals

**Goals:**
- 把「拉起一支 N 人团队」压缩成 1 次工具调用 + 1 轮 round-trip
- 与现有 `create` 单成员语义保持一致（创建即派活：每个成员可选自带初始 task）
- 容量 / 重名 / 校验错误有清晰、可恢复的反馈

**Non-Goals:**
- 不改 `TeamManager.createMember` / `assignTask` 接口
- 不引入事务、不回滚已创建成员（部分成功由汇总报告承载）
- 不并行创建成员（顺序循环已远快于 N 个 round-trip，并行只会引入资源抖动）
- 不改程序化 API（`server/index.ts` / `client/*`）

## Decisions

### D1：新增 `action="create-batch"` 而非扩展 `create`

**选择**：新增独立 action。

**理由**：
- `create` 已有 name/role/goal/taskTitle/taskDescription/taskPriority 一组单成员参数。若让 `create` 同时接受 `members` 数组，会形成「单成员模式 vs 批量模式」的互斥分支，schema 复杂、prompt 模糊。
- 独立 action 让 schema 单一职责：`create-batch` 只看 `members`，`create` 只看单成员字段，互不干扰。
- 工具 description 对 leader 更清晰：单成员和批量是两个不同意图。

**备选**：扩展 `create` 同时支持单/多模式。**否决**——互斥参数增加 LLM 误用率。

### D2：`members` 数组项 schema 与 `create` 单成员字段一一对应

```
members: Array<{
  name: string                      // 必填
  role: string                      // 必填
  goal: string                      // 必填
  taskTitle?: string                // 可选 — 创建即派活
  taskDescription?: string          // 可选
  taskPriority?: "high"|"medium"|"low"
}>
```

**理由**：与 `handleCreate` 现有字段对齐，leader 不需要在两种调用间切换心智模型。

### D3：三层错误语义 —— 容量 fail-fast，个体 best-effort，assignTask 三态

```
                  ┌──────────────────────────────────────────┐
                  │   容量预检 (tool 层，进入循环前)         │
                  │   if (listMembers().length + N > max)    │
                  │     → 整批拒绝，不创建任何成员           │
                  └────────────────┬─────────────────────────┘
                                   │ 通过
                                   ▼
   for (const m of members):
     try { state = await manager.createMember(m) }  ← 独立 try/catch
     catch → failed.push({name, error: msg}); continue
     │
     ├─ 无 taskTitle → succeeded.push({name, role, taskId: null})
     │
     └─ 有 taskTitle:
        try { task = manager.assignTask(...) }     ← 独立 try/catch
        catch → succeeded.push({name, role, taskId: null,
                                warn: "task error: " + msg})
                 ↑ 成员已存在，必须记为成功（带 warn），
                   否则 Leader 重试会撞 "already exists"
        ok   → succeeded.push({name, role, taskId: task.id})

   三态汇总（按结果桶）:
     - succeeded_with_task[N]   ✓ name (role) [T<id>]
     - succeeded_no_task[M]     ✓ name (role) — no task
     - succeeded_task_warn[K]   ✓ name (role) — task error: <msg>
     - failed[L]                ✗ name: <error>
```

**assignTask 独立 try/catch 的理由**：`createMember` 成功后成员已经写入 `this.members` Map 和磁盘 `TEAM.md`，是不可逆状态。若把 `assignTask` 放进同一个 try 块，assignTask 抛错会把成员误判为 failed —— Leader 看到 failed 会尝试重新 `create`，撞上 `members.has(name)` 抛 "already exists"。三态语义保证磁盘真相与报告一致：成员存在 = succeeded（带可选 warn）。

**容量层 fail-fast 的理由**：如果容量已知不够，让循环跑到一半再因为容量竞争失败，会产生「前 3 个成功、第 4 个失败」这种难以恢复的中间态。提前整批拒绝，leader 能立即决定调整成员名单或先 remove 旧成员。

**个体层 best-effort 的理由**：重名 / 名字非法是个体问题，不应连累其他合法成员。返回报告让 leader 自主决策。

### D4：不引入事务 / 回滚

**选择**：失败时保留已创建成员。

**理由**：
- `createMember` 内部创建了 session、member 目录、修改了 `TEAM.md`，回滚要逆向操作，复杂且易错。
- 部分成功的团队本身是有用状态——leader 可以读汇总报告，决定保留、改名重试或 remove。
- 工具语义保持简单：批量 = 多次单条调用的语法糖，行为可预测。

### D5：批量软上限

tool 层额外校验 `members.length`（建议 ≤ 20）。理由：maxWorkers 已是硬上限，但即便 maxWorkers 很大，单次 tool call 创建几十个成员会让结果文本过长、单次执行时间过长，影响交互体验。20 是经验值，可在 design 评审时调整。

### D6：报告格式规范（固定逐行格式）

汇总文本必须使用固定格式，确保 Leader agent 后续轮次能稳定解析，测试能精确断言。三桶分组，每条一行：

```
Created 3 member(s):
  ✓ alice (frontend) [T1]
  ✓ bob (backend) [T2]
  ✓ carol (qa) — no task
  ✓ dave (devops) — task error: session not idle
Failed 1 member(s):
  ✗ eve: member "eve" already exists
```

格式规则：
- 每行以 `✓ `（成功）或 `✗ `（失败）开头，对齐列在成员名前
- 成功行：`<name> (<role>)` 后接任务状态
  - 有 task：` [T<id>]`（assignTask 成功）
  - 无 task：` — no task`（未提供 taskTitle）
  - task 失败：` — task error: <msg>`（assignTask 抛错但成员已创建，必须归成功桶）
- 失败行：`<name>: <error message>`（createMember 抛错）
- 行尾无标点；每桶之间空行分隔
- 桶标题使用复数变体：`1 member` / `2 member(s)`，便于正则解析

整批拒绝（容量预检失败）格式：

```
Batch rejected: capacity exceeded.
  Current members: 3
  Batch size: 4
  maxWorkers: 5
  Remove existing members first or reduce batch size.
```

空数组 / 超软上限 / 缺失 members 同样返回固定 `Error: <reason>` 单行格式。

## Risks / Trade-offs

- **[部分成功后磁盘残留 session 文件]** → `createMember` 失败时其内部已负责清理 session 目录；批量失败汇总会明确指出谁没创建成功，leader 可对真正成功但不需要的成员走 `remove` 流程。
- **[maxWorkers 在批量执行中发生变化]** → 单线程顺序执行，无并发；`members.size` 在循环中持续增长但已通过入口预检，不会越界。
- **[结果文本过长]** → 软上限 20 + 每条一行紧凑格式。若 leader 仍嫌长，可后续加 `team(action="read")` 查看精简状态。
- **[与未来程序化批量 API 重复]** → 当前程序化 API 无批量诉求；若未来出现，可抽公共函数 `bulkCreateMembers(manager, list)` 复用，不在本期设计内。

## Migration Plan

- **部署**：纯新增 action + 可选参数，无 breaking change，无需迁移。
- **回滚**：移除 `create-batch` 分支与 `members` schema 字段即可完整回滚；`create` 行为完全不变。

## Open Questions

无。所有边界已在 Decisions 中明确。
