## 1. 提取核心函数（不做字段校验，契约：调用方已校验）

- [x] 1.1 在 `src/tools/team.ts` 顶部 import `MemberState` 类型；新增两个私有类型：
  - `CoreResult = { ok: true; taskId?: string } | { ok: false; error: string }`
  - `CreateOneResult = { ok: true; state: MemberState; taskId: string } | { ok: true; state: MemberState; taskId: null; taskWarn: string } | { ok: false; error: string }`（Oracle 复核建议：分支1 taskId 精度为 string，全成功必有 taskId）
- [x] 1.2 实现 `createOneMember(manager, spec): Promise<CreateOneResult>`：
  - spec 字段：`{name, role, goal, constraints?, tools?, skills?, mcps?, taskTitle?, taskDescription?, taskPriority?}`
  - **不做字段校验**（D3：调用方负责）
  - try 包裹 `await manager.createMember({name, role, goal, constraints, model: undefined, services: {} as never, parentModel: undefined, tools: spec.tools, skills: spec.skills, mcps: spec.mcps})`（D4：直接赋值，非条件展开）
  - createMember 异常 → `return {ok:false, error: e instanceof Error ? e.message : String(e)}`
  - 若 `spec.taskTitle`：独立 try 包裹 `manager.assignTask({title: spec.taskTitle, description: spec.taskDescription ?? "", memberName: spec.name, priority: spec.taskPriority ?? "medium"})`
    - assignTask 异常 → `return {ok:true, state, taskId: null, taskWarn: e instanceof Error ? e.message : String(e)}`
  - 成功 → `return {ok:true, state, taskId: task?.id ?? null}`
- [x] 1.3 实现 `assignOneTask(manager, spec): CoreResult`：
  - spec：`{name, title, description?, priority?}`
  - **不做字段校验**
  - try 包裹 `manager.assignTask({title: spec.title, description: spec.description ?? "", memberName: spec.name, priority: spec.priority ?? "medium"})`
  - 异常 → `{ok:false, error}`；成功 → `{ok:true, taskId: task.id}`
- [x] 1.4 实现 `directOneMessage(manager, spec): CoreResult`：
  - spec：`{name, kind, payload}`
  - **不做字段校验**
  - try 包裹 `manager.directMember(spec.name, spec.kind, spec.payload)`
  - 异常 → `{ok:false, error}`；成功 → `{ok:true}`

## 2. 改写单条 handler（字段校验留 handler + 保持返回字面量 + taskWarn → isError）

- [x] 2.1 改写 `handleCreate(manager, args)`：
  - **保留**字段校验（字面量逐字不变）：`!name` → `err("name is required for create")`、`!role` → `err("role is required for create")`、`!goal` → `err("goal is required for create")`
  - 调 `createOneMember(manager, {name, role, goal, constraints, tools, skills, mcps, taskTitle, taskDescription, taskPriority})`
  - 结果为 `{ok:false, error}` → `return err(error)`
  - 结果为 `{ok:true, taskWarn}`（成员成功但任务失败）→ **`return err(taskWarn)`**（D5：复现原异常冒泡 isError:true，错误消息用 taskWarn 字符串）
  - 结果为 `{ok:true, taskId: string}`（全成功，有任务）→ 返回 `` `Member "${name}" (${role}) created and working on "${taskTitle}" [${taskId}]. Status: active` ``（逐字核对原 line 330）
  - 结果为 `{ok:true, taskId: null}`（成功无任务）→ 组装原 toolSummary 段（tools/skills/mcps 摘要，逻辑同原 line 334-340）+ `` `Member "${name}" (${role}) created. Status: ${state.status}${toolSummary ? `. ${toolSummary}` : ""}` ``
- [x] 2.2 改写 `handleAssign(manager, args)`：
  - **保留**校验（字面量不变）：`!name` → `err("name (member) is required for assign")`、`!title` → `err("title is required for assign")`
  - 调 `assignOneTask(manager, {name, title, description, priority})`
  - 失败 → `err(error)`；成功 → `` `Task ${taskId} "${title}" assigned to @${name}. Member is now active.` ``（逐字核对原 line 474）
- [x] 2.3 改写 `handleDirect(manager, args)`：
  - **保留**校验（字面量不变）：`!name` → `err("name is required for direct")`、`!kind` → `err("kind is required for direct")`、`!payload` → `err("payload is required for direct")`
  - 调 `directOneMessage(manager, {name, kind, payload})`
  - 失败 → `err(error)`；成功 → `` `Message sent to ${name} [${kind}].` ``（逐字核对原 line 542）

## 3. 改写批量 handler（保留容量/软上限/失败隔离，循环体换核心函数）

- [x] 3.1 改写 `handleCreateBatch`：
  - 保留：members 非空校验（`err("members array is required and must not be empty")`）、`CREATE_BATCH_SOFT_LIMIT` 软上限、`currentCount + members.length > maxWorkers` 容量前置（字面量逐字不变）、succeeded/failed 桶、汇总文本格式（`Created N member(s):` / `Failed M member(s):`，`✓`/`✗` 格式不变）
  - 循环体替换：原 `manager.createMember(...)` + 可选独立 try/catch `manager.assignTask(...)` → 一次 `const result = await createOneMember(manager, m)`
  - `result.ok === false` → `failed.push({name: m.name, error: result.error})`
  - `result.ok === true && result.taskWarn` → `succeeded.push({name: m.name, role: m.role, taskId: null, taskWarn: result.taskWarn})`（原 line 426-432 行为）
  - `result.ok === true && result.taskId` → `succeeded.push({name, role, taskId})`
  - `result.ok === true && !result.taskId && !result.taskWarn` → `succeeded.push({name, role, taskId: null})`
  - 汇总文本逻辑保持不变（line 435-460）
- [x] 3.2 改写 `handleAssignBatch`：
  - 保留：tasks 非空、`ASSIGN_BATCH_SOFT_LIMIT`、succeeded/failed 桶、汇总格式
  - 循环体替换为 `const result = assignOneTask(manager, t)`
  - 失败 → failed；成功 → `succeeded.push({name: t.name, taskId: result.taskId, title: t.title})`
- [x] 3.3 改写 `handleDirectBatch`：
  - 保留：messages 非空、`DIRECT_BATCH_SOFT_LIMIT`、串行循环、succeeded/failed 桶、汇总格式
  - 循环体替换为 `const result = directOneMessage(manager, m)`
  - 失败 → failed；成功 → `succeeded.push({name: m.name, kind: m.kind, payload: m.payload})`

## 4. 清理

- [x] 4.1 确认 `execute` 的 switch 分支、`ActionSchema`、`TeamParamsSchema`、`createTeamTool.description` **零改动**（diff 核对）
- [x] 4.2 删除原 handler 里现已无用的局部变量（如 `handleCreate` 原来的 `const tools = args.tools as ...`、`const state = await manager.createMember(...)`）
- [x] 4.3 确认外层 `execute` 的 try/catch 兜底仍在（核心函数已 try/catch，但 execute 兜底防御性保留，不动）

## 5. 测试

- [x] 5.1 新增 `tests/team-unify-single-batch.test.ts`，针对三个单条 handler 逐字断言返回文本（mock manager）：
  - create 无 task → `` `Member "x" (role) created. Status: active` ``
  - create 有 task 全成功 → `` `Member "x" (role) created and working on "..." [T1]. Status: active` ``
  - create 有 task 但 assignTask 抛 → `isError: true`，文本是 `Error: <assignTask 抛的 message>`（D5：复现原冒泡语义）
  - create 缺 name → `Error: name is required for create`，`isError: true`
  - create 缺 role / 缺 goal → 对应字面量
  - assign → `` `Task T1 "..." assigned to @x. Member is now active.` ``，缺 name/title 对应字面量
  - direct → `` `Message sent to x [context].` ``，缺 name/kind/payload 对应字面量
- [x] 5.2 同文件断言核心函数被单条和批量都调用（spy `manager.createMember` / `assignTask` / `directMember`）：
  - 单条 create 调 1 次 createMember；createBatch（N 元素）调 N 次
  - 单条 assign 调 1 次 assignTask；assignBatch（N 元素）调 N 次
  - 单条 direct 调 1 次 directMember；directBatch（N 元素）调 N 次
- [x] 5.3 断言批量场景的 taskWarn 行为：createBatch 某元素的 assignTask 抛异常 → 该元素进 succeeded 桶且带 taskWarn，不影响其他元素
- [x] 5.4 跑 `bun run check`，确认 typecheck + lint + 现有 team 测试（`tests/team-*.test.ts`）全绿，无回归

## 6. 验证清单（实施完成时逐项打勾）

- [x] 6.1 `git diff src/tools/team.ts` 中 `ActionSchema` / switch case / `TeamParamsSchema` / `createTeamTool.description` 行零改动
- [x] 6.2 单条返回文本字面量与重构前完全一致（5.1 覆盖）
- [x] 6.3 单条 create 任务失败仍为 `isError:true`（D5 复现原冒泡）
- [x] 6.4 批量返回文本格式与重构前完全一致（现有 batch 测试 + 5.3）
- [x] 6.5 核心函数 `createOneMember`/`assignOneTask`/`directOneMessage` 不含字段校验（D3）
- [x] 6.6 `createMember` 传参用直接赋值（`tools: spec.tools` 等，D4）
- [x] 6.7 `bun run check` 全绿
- [x] 6.8 确认 taskWarn / error 取值规则统一为 `e instanceof Error ? e.message : String(e)`（与原 execute catch line 255-257 一致），单条 `err(taskWarn)` 输出文本 `Error: <message>` 与原冒泡路径对齐
- [x] 6.9 新增断言测试锁定 `filterMemberTools(undefined)` / `resolveMcps(undefined)` 对 undefined 等价（防 manager 后续重构破坏 D4 前提）
