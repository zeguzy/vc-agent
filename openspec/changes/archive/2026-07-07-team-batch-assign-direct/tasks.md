## 1. Tool 层 schema 与 action 接入

- [x] 1.1 在 `src/tools/team.ts` 的 `ActionSchema` 联合类型中新增 `Type.Literal("assign-batch")` 和 `Type.Literal("direct-batch")`
- [x] 1.2 在 `TeamParamsSchema` 新增可选字段 `tasks`：`Type.Optional(Type.Array(Type.Object({ name, title, description?, priority? })))`，description 标注仅 `assign-batch` 消费
- [x] 1.3 在 `TeamParamsSchema` 新增可选字段 `messages`：`Type.Optional(Type.Array(Type.Object({ name, kind: Union[directive,context,redirect], payload })))`，description 标注仅 `direct-batch` 消费
- [x] 1.4 在 `createTeamTool` 的 `execute` 内部 args 类型扩展 `tasks?` 和 `messages?` 字段
- [x] 1.5 在 `execute` 的 switch 中新增 `case "assign-batch": return handleAssignBatch(manager, args);` 和 `case "direct-batch": return handleDirectBatch(manager, args);`

## 2. handleAssignBatch 实现

- [x] 2.1 新增导出常量 `ASSIGN_BATCH_SOFT_LIMIT = 20`
- [x] 2.2 实现 `handleAssignBatch(manager, args)`：
  - 校验 `tasks` 存在且非空，否则返回 err（`Error: tasks array is required and must not be empty`）
  - 校验 `tasks.length <= ASSIGN_BATCH_SOFT_LIMIT`，否则返回 err
  - 顺序遍历 `tasks`，每项独立 try/catch 包裹 `manager.assignTask({ title, description: description ?? "", memberName: name, priority: priority ?? "medium" })`
  - 失败 → `failed.push({name, error: msg})`；成功 → `succeeded.push({name, taskId: task.id, title})`
  - 按 D6 格式组装：`Assigned N task(s):` 段（每行 `✓ <taskId> "<title>" → @<name>`）+ 可选 `Failed M task(s):` 段（每行 `✗ @<name>: <error>`）；任一成功即非 isError

## 3. handleDirectBatch 实现

- [x] 3.1 新增导出常量 `DIRECT_BATCH_SOFT_LIMIT = 20`
- [x] 3.2 实现 `handleDirectBatch(manager, args)`：
  - 校验 `messages` 存在且非空，否则返回 err
  - 校验 `messages.length <= DIRECT_BATCH_SOFT_LIMIT`，否则返回 err
  - 顺序遍历 `messages`（**串行，不并行**），每项独立 try/catch 包裹 `manager.directMember(name, kind, payload)`
  - 同成员多条 redirect 按数组顺序应用，后覆盖前（D4）
  - 失败 → `failed.push({name, error})`；成功 → `succeeded.push({name, kind, payload})`
  - 按 D6 格式组装：`Sent N message(s):` 段（每行 `✓ @<name> [<kind>]: <payload 截断到 60 字符>`）+ 可选 `Failed M message(s):` 段；任一成功即非 isError

## 4. 工具 description 更新

- [x] 4.1 更新 `createTeamTool` 的 `description` 文本：
  - 新增 `assign-batch` 用法说明 + 示例（含 per-item 失败隔离说明）
  - 新增 `direct-batch` 用法说明 + 示例（含同成员多 redirect 后覆盖前的串行语义说明）

## 5. 测试

- [x] 5.1 新增 `tests/team-batch-assign-direct.test.ts`，mock TeamManagerLike，覆盖：
  - **assign-batch 全部成功**（验证 `Assigned N task(s):` 段、taskId、`→ @name`）
  - **assign-batch 部分失败**（成员不存在，验证其他仍派发、`Failed M task(s):` 段）
  - **assign-batch tasks 缺失/空数组**（返回固定 err）
  - **assign-batch 超软上限**（N=21，返回 err）
  - **assign-batch 全失败 isError=true**
  - **direct-batch 全部成功**（验证 `Sent N message(s):` 段、`[kind]`）
  - **direct-batch 部分失败**（成员不存在）
  - **direct-batch 同成员多 redirect 串行覆盖**（验证 directMember 调用顺序、全部成功）
  - **direct-batch messages 缺失/空数组**
  - **direct-batch 超软上限**
  - **direct-batch payload 截断**（payload > 60 字符，验证报告里截断 + `…`）
  - **assign / direct 单条向后兼容**（不带数组，走原路径）
- [x] 5.2 跑 `bun test tests/team-batch-assign-direct.test.ts` 全绿

## 6. 验证

- [x] 6.1 跑 `bun run check`：typecheck 改动文件零新错误、lint 无新 error、全部 team 相关测试通过
- [x] 6.2 人工审阅 `createTeamTool` 的 description 文本，确认 leader agent 能理解两个 batch action 的用法（含示例 + 失败/覆盖语义说明）
