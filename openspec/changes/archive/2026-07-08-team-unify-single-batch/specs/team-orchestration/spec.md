## ADDED Requirements

### Requirement: team 工具单条与批量 action 共享核心调用逻辑

`team` 工具的单条 action（`create` / `assign` / `direct`）与对应批量 action（`create-batch` / `assign-batch` / `direct-batch`）SHALL 共享同一份核心调用逻辑（在 `src/tools/team.ts` 内提取为私有核心函数 `createOneMember` / `assignOneTask` / `directOneMessage`），避免「调 `TeamManager` + 异常转字符串」逻辑的重复。核心函数 SHALL 封装「对单个目标调一次 `TeamManager` 接口」的完整逻辑并返回判别联合（`CoreResult` / `CreateOneResult`），单条 handler 调核心函数一次，批量 handler 顺序循环调核心函数。**所有外部可观测行为（`action` 联合类型字面量、`TeamParamsSchema` 字段、tool description、单条与批量各自的返回文本格式、`isError` 语义、错误信息字面量）SHALL 保持与重构前完全一致。**

#### Scenario: 单条 action 返回格式保持不变

- **WHEN** leader agent 调用 `team` 工具，参数 `{ action: "create", name: "x", role: "r", goal: "g" }`（无 taskTitle）
- **THEN** 系统 SHALL 返回单行文本 `` `Member "x" (r) created. Status: <status>` ``，格式与重构前逐字一致
- **AND** `isError` SHALL 为 false
- **WHEN** 调用 `{ action: "create", name: "x", role: "r", goal: "g", taskTitle: "t" }` 且 assignTask 成功
- **THEN** 系统 SHALL 返回 `` `Member "x" (r) created and working on "t" [<taskId>]. Status: active` ``
- **WHEN** 调用 `{ action: "assign", name: "x", title: "t" }`
- **THEN** 系统 SHALL 返回 `` `Task <taskId> "t" assigned to @x. Member is now active.` ``
- **WHEN** 调用 `{ action: "direct", name: "x", kind: "context", payload: "p" }`
- **THEN** 系统 SHALL 返回 `` `Message sent to x [context].` ``

#### Scenario: 单条 action 必填校验错误信息保持不变（字段校验留在单条 handler）

- **WHEN** 调用 `{ action: "create", role: "r", goal: "g" }`（缺 name）
- **THEN** 系统 SHALL 返回 `Error: name is required for create`，`isError: true`
- **WHEN** 调用 `{ action: "create", name: "x", goal: "g" }`（缺 role）
- **THEN** 系统 SHALL 返回 `Error: role is required for create`，`isError: true`
- **WHEN** 调用 `{ action: "assign", name: "x" }`（缺 title）
- **THEN** 系统 SHALL 返回 `Error: title is required for assign`，`isError: true`
- **WHEN** 调用 `{ action: "direct", name: "x" }`（缺 kind）
- **THEN** 系统 SHALL 返回 `Error: kind is required for direct`，`isError: true`

#### Scenario: 核心函数不做字段校验

- **WHEN** 审查 `createOneMember` / `assignOneTask` / `directOneMessage` 的实现
- **THEN** 这些函数 SHALL NOT 包含 name/role/goal/title/kind/payload 等字段的必填校验
- **AND** 字段校验 SHALL 保留在单条 handler 入口（保持原字面量）
- **AND** 批量 handler 循环内 SHALL 继续不做 per-item 字段校验（字段缺失靠 `TeamManager` 接口抛异常进 `failed` 桶，与重构前一致）

#### Scenario: 单条 create 任务失败保持 isError:true（复现原异常冒泡）

- **WHEN** 调用 `{ action: "create", name: "x", role: "r", goal: "g", taskTitle: "t" }`，且 `manager.assignTask` 抛异常
- **THEN** 系统 SHALL 返回 `isError: true`
- **AND** 错误文本 SHALL 为 `Error: <assignTask 抛出的 message>`
- **AND** 此行为 SHALL 与重构前一致（重构前单条 create 的 assignTask 无 try/catch，异常冒泡到外层 execute try/catch 转 isError:true）

#### Scenario: 批量 action 行为与返回格式保持不变

- **WHEN** 调用 `{ action: "create-batch", members: [...] }` / `{ action: "assign-batch", tasks: [...] }` / `{ action: "direct-batch", messages: [...] }`
- **THEN** 系统 SHALL 保留容量前置检查（create-batch）、软上限检查（`*_BATCH_SOFT_LIMIT = 20`）、per-item 失败隔离、succeeded/failed 汇总文本格式
- **AND** 每项的成功/失败判定 SHALL 与重构前一致（如 create-batch 中"成员成功但任务失败"仍记为 succeeded 且带 `taskWarn`，不影响其他项）

#### Scenario: 核心函数被单条与批量共享

- **WHEN** 任一单条 action 被调用
- **THEN** 系统 SHALL 通过对应核心函数（`createOneMember` / `assignOneTask` / `directOneMessage`）调用 `TeamManager` 接口，调用次数 = 1
- **WHEN** 任一批量 action 被调用
- **THEN** 系统 SHALL 通过同一核心函数顺序循环调用 `TeamManager` 接口，调用次数 = 数组长度

#### Scenario: createMember 传参对 undefined 与字段缺失等价

- **WHEN** 核心函数 `createOneMember` 调用 `manager.createMember`
- **THEN** `tools` / `skills` / `mcps` 字段 SHALL 使用直接赋值（`tools: spec.tools`，而非条件展开 `...(tools ? {tools} : {})`）
- **AND** 因 `TeamManager.createMember` 内部对 `undefined` 等价处理（`filterMemberTools(undefined)`、`opts.skills ?? []`、`resolveMcps(undefined)`），单条外部行为 SHALL 不变

#### Scenario: schema 与 tool description 零改动

- **WHEN** 审查 `src/tools/team.ts` 的 diff
- **THEN** `ActionSchema` 联合类型字面量集合、`TeamParamsSchema` 字段定义、`createTeamTool` 返回的 `description` 字段 SHALL 与重构前逐字一致
