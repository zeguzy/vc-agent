## Why

`src/tools/team.ts` 里 `create` / `assign` / `direct` 三个单条 action 与对应的 `*-batch` 批量 action 各写一份几乎相同的核心逻辑（参数校验、调 `TeamManager`、错误捕获）。三对 handler 之间是复制粘贴关系，任何一处行为修正（如新增 `constraints` 透传）都要同步改两处，已经出过漏改的坑（`constraints` 字段是后补到两边各一次的）。

这是 team 工具内部的可维护性债务：核心逻辑应该只有一份，单个和批量只是「调用一次 vs 循环调用」+「返回格式」的差别。

## What Changes

- 在 `src/tools/team.ts` 内部提取三个私有核心函数，每个封装「对单个目标调一次 `TeamManager` 接口」的逻辑：
  - `createOneMember(manager, spec)` —— `createMember` + 可选首任务 `assignTask`
  - `assignOneTask(manager, spec)` —— `assignTask`
  - `directOneMessage(manager, spec)` —— `directMember`
- `handleCreate` / `handleAssign` / `handleDirect`（单条 handler）改为调用对应核心函数一次，**保持原有返回格式和错误语义完全不变**
- `handleCreateBatch` / `handleAssignBatch` / `handleDirectBatch` 改为循环调用同一核心函数，批量专属逻辑（容量前置检查、软上限、失败隔离、汇总文本）保留在 batch handler 外壳里
- `team` 工具的 `action` 联合类型、`TeamParamsSchema`、tool description、所有外部可观测行为（返回文本格式、`isError` 语义、错误信息字面量）**全部不变**

## Capabilities

### Modified Capabilities

- `team-orchestration`: 单条 action（`create` / `assign` / `direct`）与批量 action（`create-batch` / `assign-batch` / `direct-batch`）SHALL 共享同一份核心调用逻辑（提取为内部函数），外部行为契约不变

## Impact

- **代码**：仅 `src/tools/team.ts`（纯内部重构，提取 3 个核心函数 + 改写 6 个 handler 的实现，不动 schema/switch/description）
- **API**：无变化。`team` 工具参数、返回文本、`isError` 语义、错误信息字面量全部保持原样
- **依赖**：无新增
- **测试**：现有 `tests/team-*.test.ts` 全部应保持通过（行为不变）；新增针对性单测锁定「单条返回格式不变」+「核心函数被两边调用」

## Non-goals

- **不合并 action**：`create` 与 `create-batch` 等仍是独立 action 字面量，schema 不变；LLM 仍享单条形态的简洁调用
- **不改返回格式**：单条 handler 返回简洁单行（如 `Member "x" created. Status: active`），批量 handler 返回 succeeded/failed 列表；两者格式各自保持
- **不改错误语义**：单条失败仍直接 `isError: true`；批量失败仍 per-item 隔离，全失败才 `isError`
- **不改软上限 / 容量检查**：`*_BATCH_SOFT_LIMIT = 20`、批量前置容量检查均保留原位
- **不动 `TeamManager` 接口**：核心函数仍调既有 `createMember` / `assignTask` / `directMember`
- **不动程序化 API（server / client / http）**：仅 tool 层重构
