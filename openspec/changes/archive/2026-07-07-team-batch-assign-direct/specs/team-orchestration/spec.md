## ADDED Requirements

### Requirement: team 工具支持 assign-batch 批量分配任务

系统 SHALL 在 `team` 工具的 `action` 联合类型中新增 `"assign-batch"` 字面量。该 action 接受一个 `tasks` 数组参数，每项结构为 `{ name: string, title: string, description?: string, priority?: "high" | "medium" | "low" }`，在一次工具调用内给多个成员分配任务。批量逻辑全部位于 `src/tools/team.ts` 的 tool 层，循环调用既有 `TeamManager.assignTask`（单条接口语义不变）。原 `action="assign"` 单任务行为 SHALL 保持完全向后兼容。

#### Scenario: 全部任务分配成功

- **WHEN** leader agent 调用 `team` 工具，参数 `{ action: "assign-batch", tasks: [{ name: "sasha", title: "Login validation", description: "..." }, { name: "marcus", title: "API schema", priority: "high" }] }`
- **THEN** 系统 SHALL 对 `tasks` 数组顺序调用 `TeamManager.assignTask`，每项使用独立的 try/catch
- **AND** 系统 SHALL 返回汇总文本 `Assigned N task(s):` 段，每行 `✓ <taskId> "<title>" → @<name>`
- **AND** `isError` SHALL 为 false

#### Scenario: 部分任务分配失败，其他任务仍被分配

- **WHEN** `tasks` 数组中某项的 `name` 对应的成员不存在，或成员非 idle
- **THEN** 系统 SHALL 对每项独立尝试 `assignTask`，使用独立的 try/catch
- **AND** 单个 `assignTask` 失败 SHALL NOT 中断后续任务的分配
- **AND** 失败项 SHALL 进入 failed 桶，汇总行格式 `✗ @<name>: <error message>`
- **AND** 成功项 SHALL 正常分配并进入 succeeded 桶

#### Scenario: tasks 数组为空或缺失

- **WHEN** leader agent 调用 `{ action: "assign-batch" }` 且未提供 `tasks`，或 `tasks` 为空数组
- **THEN** 系统 SHALL 返回错误信息提示 `tasks` 数组为必填且不能为空
- **AND** 系统 SHALL NOT 调用任何 `assignTask`

#### Scenario: tasks 数组超出软上限

- **WHEN** `tasks.length` 超过 `ASSIGN_BATCH_SOFT_LIMIT`（默认 20）
- **THEN** 系统 SHALL 返回错误信息，提示拆分多次调用
- **AND** 系统 SHALL NOT 分配任何任务

#### Scenario: assign 单任务行为保持不变

- **WHEN** leader agent 调用 `{ action: "assign", name, title, ... }`（不带 `tasks`）
- **THEN** 系统 SHALL 走原有 `handleAssign` 路径，行为完全一致
- **AND** 系统 SHALL NOT 校验或消费 `tasks` 字段

### Requirement: team 工具支持 direct-batch 批量发送消息

系统 SHALL 在 `team` 工具的 `action` 联合类型中新增 `"direct-batch"` 字面量。该 action 接受一个 `messages` 数组参数，每项结构为 `{ name: string, kind: "directive" | "context" | "redirect", payload: string }`，在一次工具调用内给多个成员发送消息。批量逻辑全部位于 `src/tools/team.ts` 的 tool 层，**串行**循环调用既有 `TeamManager.directMember`（单条接口语义不变）。原 `action="direct"` 单消息行为 SHALL 保持完全向后兼容。

#### Scenario: 全部消息发送成功

- **WHEN** leader agent 调用 `team` 工具，参数 `{ action: "direct-batch", messages: [{ name: "sasha", kind: "context", payload: "design at /docs/m.fig" }, { name: "marcus", kind: "directive", payload: "use JWT" }] }`
- **THEN** 系统 SHALL 按 `messages` 数组顺序串行调用 `TeamManager.directMember`，每项使用独立的 try/catch
- **AND** 系统 SHALL 返回汇总文本 `Sent N message(s):` 段，每行 `✓ @<name> [<kind>]: <payload>`（payload 超过 60 字符时截断并以 `…` 结尾）
- **AND** `isError` SHALL 为 false

#### Scenario: 同一成员的多条 redirect 按数组顺序串行应用，后覆盖前

- **WHEN** `messages` 数组包含对同一成员的多条 `redirect`，如 `[{ name: "sasha", kind: "redirect", payload: "do A" }, { name: "sasha", kind: "redirect", payload: "do B" }]`
- **THEN** 系统 SHALL 按数组顺序依次调用 `directMember("sasha", "redirect", "do A")` 然后 `directMember("sasha", "redirect", "do B")`
- **AND** 最终成员状态 SHALL 反映最后一条 redirect（"do B"）
- **AND** 系统 SHALL NOT 检测或拒绝同成员重复 redirect

#### Scenario: 部分消息发送失败，其他消息仍被发送

- **WHEN** `messages` 数组中某项的 `name` 对应的成员不存在
- **THEN** 系统 SHALL 对每项独立尝试 `directMember`
- **AND** 单个失败 SHALL NOT 中断后续消息
- **AND** 失败项汇总行格式 `✗ @<name>: <error message>`

#### Scenario: messages 数组为空或缺失

- **WHEN** leader agent 调用 `{ action: "direct-batch" }` 且未提供 `messages`，或 `messages` 为空数组
- **THEN** 系统 SHALL 返回错误信息提示 `messages` 数组为必填且不能为空
- **AND** 系统 SHALL NOT 调用任何 `directMember`

#### Scenario: messages 数组超出软上限

- **WHEN** `messages.length` 超过 `DIRECT_BATCH_SOFT_LIMIT`（默认 20）
- **THEN** 系统 SHALL 返回错误信息，提示拆分多次调用

#### Scenario: direct 单消息行为保持不变

- **WHEN** leader agent 调用 `{ action: "direct", name, kind, payload }`（不带 `messages`）
- **THEN** 系统 SHALL 走原有 `handleDirect` 路径，行为完全一致
- **AND** 系统 SHALL NOT 校验或消费 `messages` 字段
