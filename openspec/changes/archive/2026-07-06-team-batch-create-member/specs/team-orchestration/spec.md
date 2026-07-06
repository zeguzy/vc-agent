## ADDED Requirements

### Requirement: team 工具支持 create-batch 批量创建成员

系统 SHALL 在 `team` 工具的 `action` 联合类型中新增 `"create-batch"` 字面量。该 action 接受一个 `members` 数组参数，每项结构为 `{ name: string, role: string, goal: string, taskTitle?: string, taskDescription?: string, taskPriority?: "high" | "medium" | "low" }`，在一次工具调用内创建多个成员。批量逻辑全部位于 `src/tools/team.ts` 的 tool 层，循环调用既有 `TeamManager.createMember`（单条接口语义不变），每个成员在创建成功后若提供 `taskTitle` 则立即调用 `TeamManager.assignTask` 分配初始任务。原 `action="create"` 单成员行为 SHALL 保持完全向后兼容。

#### Scenario: 容量预检通过，全部成员创建成功

- **WHEN** leader agent 调用 `team` 工具，参数 `{ action: "create-batch", members: [{ name: "alice", role: "frontend", goal: "UI" }, { name: "bob", role: "backend", goal: "API", taskTitle: "design schema", taskDescription: "..." }] }`
- **AND** 当前成员数 + `members.length` ≤ `config.maxWorkers`
- **THEN** 系统 SHALL 对 `members` 数组顺序调用 `TeamManager.createMember`
- **AND** 对每个提供 `taskTitle` 的成员 SHALL 紧接着调用 `TeamManager.assignTask`，使用与 `createMember` 独立的 try/catch
- **AND** 系统 SHALL 返回汇总文本，使用固定三桶格式（参见 design D6）：`Created N member(s):` 段每行 `✓ <name> (<role>) [T<id>]` 或 `✓ <name> (<role>) — no task`；`Failed 0 member(s):` 段省略或留空
- **AND** 提供了 taskTitle 的成员行 SHALL 包含分配的 taskId

#### Scenario: 容量预检失败，整批拒绝

- **WHEN** leader agent 调用 `team` 工具，参数 `members` 数组长度为 N
- **AND** 当前 `TeamManager.members.size` + N > `config.maxWorkers`
- **THEN** 系统 SHALL 在调用任何 `createMember` 之前返回错误
- **AND** 系统 SHALL NOT 创建任何成员
- **AND** 系统 SHALL 在错误信息中说明当前成员数、批量大小、maxWorkers 上限

#### Scenario: 部分成员 createMember 失败，其他成员仍被创建

- **WHEN** `members` 数组中存在重名成员（与现有成员或数组内其他项冲突）或 `validateName` 失败的非法名字
- **AND** 容量预检已通过
- **THEN** 系统 SHALL 对每个成员独立尝试 `createMember`，使用独立的 try/catch 包裹
- **AND** 单个 `createMember` 失败 SHALL NOT 中断后续成员的创建
- **AND** 失败成员 SHALL 进入 failed 桶，汇总行格式 `✗ <name>: <error message>`
- **AND** 成员未被写入 `TeamManager.members` 或磁盘（`createMember` 在状态修改前抛错）

#### Scenario: createMember 成功但 assignTask 失败时归为成功桶（带 warn）

- **WHEN** 某成员的 `createMember` 成功（已写入 `members` Map 与 `TEAM.md`）
- **AND** 该成员提供了 `taskTitle` 但后续 `assignTask` 抛错
- **THEN** 系统 SHALL 使用独立的 try/catch 包裹 `assignTask`，与 `createMember` 的 try/catch 分离
- **AND** 该成员 SHALL 进入 succeeded 桶（不可归为 failed），汇总行格式 `✓ <name> (<role>) — task error: <msg>`
- **AND** 该行 SHALL NOT 包含 taskId（任务未分配成功）
- **THEN** 此设计保证 Leader 重试创建该成员时会撞 `members.has(name)` 的 "already exists" 错误，而不是再次误判为 failed

#### Scenario: members 数组为空或缺失

- **WHEN** leader agent 调用 `{ action: "create-batch" }` 且未提供 `members`，或 `members` 为空数组
- **THEN** 系统 SHALL 返回错误信息提示 `members` 数组为必填且不能为空
- **AND** 系统 SHALL NOT 调用任何 `createMember`

#### Scenario: members 数组超出软上限

- **WHEN** `members.length` 超过 tool 层定义的软上限（默认 20）
- **THEN** 系统 SHALL 返回错误信息，提示建议拆分多次调用或调高软上限
- **AND** 系统 SHALL NOT 创建任何成员

#### Scenario: create 单成员行为保持不变

- **WHEN** leader agent 调用 `{ action: "create", name, role, goal, ... }`（不带 `members`）
- **THEN** 系统 SHALL 走原有 `handleCreate` 路径，行为与引入 `create-batch` 前完全一致
- **AND** 系统 SHALL NOT 校验或消费 `members` 字段
