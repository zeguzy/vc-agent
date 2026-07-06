## Why

组建一个 N 人团队目前需要 leader agent 连续调用 `team(action="create", ...)` N 次，每次都是一轮独立的 LLM round-trip：等待模型决策、tool call、再回到模型。对一个 5 人团队，光是「拉起队伍」就要花 5 个 round-trip 的延迟和 token。这是 leader 编排工作里最高频且最机械的路径，把它压缩成一次工具调用能让 leader 把 round-trip 预算花在真正的任务派发和上下文协同上。

## What Changes

- 在 `team` 工具的 `action` 联合类型中新增 `"create-batch"` 字面量
- 在工具参数 schema 中新增可选 `members: Array<{ name, role, goal, taskTitle?, taskDescription?, taskPriority? }>`，仅 `create-batch` 消费
- 新增 `handleCreateBatch` handler：循环调用现有 `manager.createMember`（单条接口保持不变），每个成员可选立即 `assignTask`，收集每个成员的成功/失败结果并以汇总文本返回
- 批量开始前做容量预检：若 `members.length + 当前成员数 > maxWorkers`，整批拒绝并返回清晰错误，不创建任何成员
- 单个成员失败（重名、validateName 等）不中断其他成员；最终结果区分 succeeded / failed 两段
- 原 `action="create"`（单成员）行为不变，向后兼容

## Capabilities

### New Capabilities
<!-- 无新增 capability。批量创建是 team 工具既有能力的扩展，归入 team-orchestration。 -->

### Modified Capabilities
- `team-orchestration`: 在 team 工具的 action 列表中新增 `create-batch`，允许一次调用创建多个成员并可选为每个成员分配初始任务；明确批量场景下的容量预检与部分失败语义

## Impact

- **代码**：`src/tools/team.ts`（schema、handler、switch、description），新增测试 `tests/team-batch-create.test.ts`
- **API**：仅 `team` 工具参数扩展（新增可选 action + 可选 members 数组），不破坏现有调用方
- **依赖**：无新增依赖；`TeamManager.createMember` / `assignTask` 接口保持不变
- **服务端**：不改 `src/server/index.ts` 的 `handleCreateMember`，不改 `client/*` 的 `createMember` —— 这些是程序化 API，调用方一次只创建一个本就是合理的；批量是 leader agent 编排层的诉求

## Non-goals

- **不修改 `TeamManager.createMember` 接口**：批量逻辑完全在 tool 层循环，保持单条接口的语义清晰
- **不引入事务/回滚**：部分成功由汇总报告承载，调用方（leader agent）能从报告里看出谁成功谁失败，并自主决定补救；引入事务会让简单工具变复杂
- **不修改程序化 API（server / client）**：本需求源于 leader agent 多次工具调用的延迟，程序化 API 不存在该问题
- **不修复预存在的 `src/dcp/core/compress/search.ts` typecheck 错误**：与本需求无关，pre-existing
- **不改变 `maxWorkers` 语义**：批量预检使用现有 `config.maxWorkers`，超限即整批拒绝
