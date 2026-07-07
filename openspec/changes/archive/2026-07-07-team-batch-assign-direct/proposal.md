## Why

Leader agent 给团队里 N 个成员派任务（`assign`）或发消息（`direct`）目前各需要 N 次独立的工具调用，每次都是一轮 LLM round-trip。典型场景：4 人团队刚组建完，leader 要给每个人派第一轮任务 → 4 个 `assign` round-trip；review 中途要给多人同步上下文 → 又是一串 `direct`。这是 leader 编排工作里仅次于「拉起队伍」的高频机械路径。

`create-batch`（2026-07-06）已经把「组建团队」压缩成 1 次调用，`assign` 和 `direct` 是同一类延迟痛点的剩余两环。本变更补齐这两个批量入口，让 leader 的 round-trip 预算花在真正的协同决策上。

## What Changes

- 在 `team` 工具的 `action` 联合类型中新增 `"assign-batch"` 和 `"direct-batch"` 两个字面量
- 在工具参数 schema 中新增两个可选数组参数：
  - `tasks: Array<{ name, title, description?, priority? }>`，仅 `assign-batch` 消费
  - `messages: Array<{ name, kind, payload }>`，仅 `direct-batch` 消费
- 新增 `handleAssignBatch` 和 `handleDirectBatch` 两个 handler：循环调用现有 `manager.assignTask` / `manager.directMember`（单条接口语义不变），收集每项成功/失败并以汇总文本返回
- per-item 失败隔离（成员不存在、成员非 idle 等）不中断其他项；最终结果区分 succeeded / failed 两段
- 新增 `ASSIGN_BATCH_SOFT_LIMIT = 20` 和 `DIRECT_BATCH_SOFT_LIMIT = 20` 两个 tool 层软上限
- 原 `action="assign"` / `action="direct"`（单条）行为不变，向后兼容

## Capabilities

### Modified Capabilities

- `team-orchestration`: 在 team 工具的 action 列表中新增 `assign-batch` 和 `direct-batch`，允许一次调用给多个成员分配任务或发送消息；明确批量场景下的 per-item 失败隔离语义与 `direct` 的串行覆盖语义

## Impact

- **代码**：`src/tools/team.ts`（schema、handler、switch、description），新增测试 `tests/team-batch-assign-direct.test.ts`
- **API**：仅 `team` 工具参数扩展（新增两个可选 action + 两个可选数组），不破坏现有调用方
- **依赖**：无新增依赖；`TeamManager.assignTask` / `directMember` 接口保持不变

## Non-goals

- **不修改 `TeamManager.assignTask` / `directMember` 接口**：批量逻辑完全在 tool 层循环
- **不引入事务/回滚**：部分成功由汇总报告承载，调用方自主决定补救
- **不修改程序化 API（server / client）**：批量是 leader agent 编排层的诉求
- **不并行执行**：顺序循环（与 create-batch 一致）；尤其 `direct` 的 `redirect` 会改成员优先级，必须串行以保证「后覆盖前」的确定语义
- **不合并两个 action**：assign 和 direct 是两种不同意图（派任务 vs 发消息），合并会让 schema 模糊
- **不复用 `CREATE_BATCH_SOFT_LIMIT`**：三个 action 的上限语义独立，各自常量便于未来独立调整
