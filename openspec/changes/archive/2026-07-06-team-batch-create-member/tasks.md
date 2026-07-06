## 1. Tool 层 schema 与 action 接入

- [x] 1.1 在 `src/tools/team.ts` 的 `ActionSchema` 联合类型中新增 `Type.Literal("create-batch")`
- [x] 1.2 在 `TeamParamsSchema` 新增可选字段 `members`：`Type.Optional(Type.Array(Type.Object({ name, role, goal, taskTitle?, taskDescription?, taskPriority? })))`，并在 description 中标注仅 `create-batch` 消费
- [x] 1.3 在 `createTeamTool` 的 `execute` 内部 args 类型扩展 `members?: Array<...>`
- [x] 1.4 在 `execute` 的 switch 中新增 `case "create-batch": return await handleCreateBatch(manager, args);` 分支

## 2. handleCreateBatch 实现

- [x] 2.1 新增私有常量 `CREATE_BATCH_SOFT_LIMIT = 20`（导出便于测试）
- [x] 2.2 实现 `handleCreateBatch(manager, args)`：
  - 校验 `members` 存在且非空，否则返回 err（固定格式 `Error: members array is required and must not be empty`）
  - 校验 `members.length <= CREATE_BATCH_SOFT_LIMIT`，否则返回 err
  - 容量预检：`manager.listMembers().length + members.length > manager.getMaxWorkers()` 则整批拒绝，错误信息使用 design D6 的 `Batch rejected: capacity exceeded.` 固定格式（含 Current members / Batch size / maxWorkers 三数）
  - 顺序遍历 `members`，**对每个成员使用两个独立的 try/catch**：
    - 第一个 try/catch 包裹 `manager.createMember({ name, role, goal, model: undefined, services: {} as never, parentModel: undefined })`；失败 → `failed.push({name, error: msg}); continue`（成员未写入磁盘）
    - 创建成功后若提供 `taskTitle`：第二个独立 try/catch 包裹 `manager.assignTask(...)`；失败 → 仍归 succeeded 桶，但 warn 字段记 `task error: <msg>`（成员已存在，不可归 failed）
    - 创建成功无 taskTitle：`succeeded.push({name, role, taskId: null})`
    - assignTask 成功：`succeeded.push({name, role, taskId: task.id})`
  - 按设计 D6 固定格式组装汇总文本：`Created N member(s):` 段（每行 `✓ <name> (<role>) [T<id>]` / `✓ <name> (<role>) — no task` / `✓ <name> (<role>) — task error: <msg>`）+ 可选 `Failed M member(s):` 段（每行 `✗ <name>: <error>`）；任一成功即非 isError
- [x] 2.3 在 `TeamManagerLike`（`src/teams/types-v2.ts`）新增只读方法 `getMaxWorkers(): number`；在 `TeamManager`（`src/teams/manager-v2.ts`）实现为 `return this.config.maxWorkers;`。当前成员数复用既有 `listMembers().length`（不扩接口）。已验证仅 `TeamManager` 实现 `TeamManagerLike`，client 类实现的是 `AgentClient`，新增方法零破坏
- [x] 2.4 更新 `createTeamTool` 的 `description` 文本，新增 `create-batch` 用法说明与示例

## 3. 测试

- [x] 3.1 新增 `tests/team-batch-create.test.ts`，覆盖以下场景（mock TeamManagerLike）：
  - 全部成功 + 一个成员带 taskTitle（验证 `Created N member(s):` 段含 `[T<id>]`）
  - 容量预检失败（listMembers 返回的成员数 + N > maxWorkers，验证整批拒绝、未调用 createMember、错误信息含三数）
  - createMember 部分失败（第二项重名抛错，验证第一、三项仍创建、`Failed M member(s):` 段含 `✗` 行）
  - **assignTask 失败但 createMember 成功**（验证成员归 succeeded 桶、行格式 `✓ <name> (<role>) — task error: <msg>`、无 taskId）
  - members 缺失 / 空数组（返回固定 err 格式）
  - 超软上限（N=21，返回 err）
  - 全部失败时 isError=true / create 单成员向后兼容（额外补充）
- [x] 3.2 跑 `bun test tests/team-batch-create.test.ts` 全绿（9/9 pass）

## 4. 验证

- [x] 4.1 跑 `bun run check`：typecheck 改动文件零新错误（31 个 dcp 错误 + 1 个 webfetch 测试失败均为 pre-existing，主 worktree 同样存在，不阻塞本次变更）；lint 改动文件无新 error；全部 team 相关测试 57/57 通过
- [x] 4.2 人工审阅 `createTeamTool` 的 description 文本，确认 leader agent 能从工具说明理解 `create-batch` 用法（含示例 + 容量/失败语义说明）
