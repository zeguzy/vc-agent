## Context

vc-agent 当前有两套 subagent 派发体系：
1. **`subagent` 工具**：通过 `runSubagent()` 创建临时 Pi SDK session，`await session.prompt()` 同步等待结果，完成后 dispose。参数为 `SubagentToolParams`（single/parallel/chain 三种模式）。
2. **`team` 工具组**：通过 `TeamManager.createMember()` 创建持久 member session，`assignTask()` 派发任务，`member_done` 事件通过 steer 注入 leader session。已有视角切换（`[`/`]` 键）和实时消息流。

**关键现有能力（Oracle 审查揭示）**：
- `session.prompt()` 是 awaitable 的，**不需要轮询 isStreaming**
- 视角切换已存在：`handleMemberNav` + `activeMemberName` + `member.session.subscribe()` + `displayMessages` 派生，用 `[`/`]` 键导航
- 异步通知已存在：`member_done` → `this.session.steer(note)` (server/index.ts:179-194)
- Tab 键已绑定 `toggleAgentMode`，**不能用于视角切换**
- WorkerMessageView 已在消息流中渲染 team member 输出（内联 bordered box）

**用户真正需要的差距**：
1. subagent 工具的参数格式和派发模式与 oh-my-openagent 不对齐（缺少 category/subagent_type/load_skills/run_in_background/task_id）
2. subagent 工具的 session 是临时性的，用完即弃，无法续接
3. subagent 工具没有异步模式，无法后台运行
4. subagent 工具的结果格式是 XML 标签，不是 oh-my-openagent 的 Markdown + `<task_metadata>` 格式
5. team member 的工具集是手动配置的受限子集，不是"与主代理同能力"

## Goals / Non-Goals

**Goals:**
- 扩展 `subagent` 工具参数，对齐 oh-my-openagent 的 `DelegateTaskArgs` 格式
- 为 subagent 添加 `run_in_background` 异步模式，复用已有的 `member_done` → steer 通知机制
- 为 subagent 添加 `task_id` 续接能力（复用已有 session）
- 统一 subagent 结果格式为 Markdown + `<task_metadata>` 块
- 让 team member 完整继承主 session 的工具集（不再手动配置受限子集）
- 复用已有的视角切换机制（`[`/`]` 键），扩展支持 subagent 子 session

**Non-Goals:**
- 不新增 `task` 工具（扩展现有 `subagent` 工具）
- 不新增 SubtaskPart 渲染组件（复用/改进现有 SubagentMessageView + WorkerMessageView）
- 不实现 category→model 路由
- 不实现 tmux 子代理
- 不实现 model fallback chain
- 不重写 TeamManager 的消息系统
- 不改变现有 team 工具接口
- 不实现 sidebar UI

## Decisions

### Decision 1: 扩展 `subagent` 工具参数，对齐 DelegateTaskArgs

**选择**：扩展现有 `subagent` 工具的参数 schema，新增 `description`、`category`、`subagent_type`、`run_in_background`、`task_id`、`command`、`load_skills` 参数。保留 single/parallel/chain 模式作为顶层结构，但 single 模式新增上述字段。

**理由**：
- Oracle 审查指出：新增 `task` 工具会创建第三个子系统，增加维护负担
- 扩展现有工具比新增工具更安全，不需要同时维护两套
- `single` 模式 + 新增字段 ≈ `DelegateTaskArgs` 的功能覆盖
- `parallel`/`chain` 模式保留，这是 oh-my-openagent 没有但 vc-agent 已有的有用能力

**替代方案**：
- A) 新增 `task` 工具替代 `subagent`→Oracle 审查否决：三系统并存，维护负担
- B) 仅修改参数名不改结构→无法对齐 DelegateTaskArgs 格式

**参数映射**：
```
现有 SubagentToolParams.single:  { mode, agent, description }
扩展后:                           { mode, agent, description, prompt, category, subagent_type, run_in_background, task_id, command, load_skills }
```
- `prompt`：完整任务描述（现有 `description` 字段重命名语义，或新增 prompt 保留 description 作为简短摘要）
- `category`：任务类别（quick/deep/ultrabrain 等），用于 prompt 构建
- `subagent_type`：直接指定 agent 类型（explore/librarian/oracle 等），与 `agent` 字段功能重叠但格式对齐
- `run_in_background`：是否异步执行
- `task_id`：续接已有 session（ses_... 格式）
- `command`：触发命令追踪
- `load_skills`：注入 skill 列表

### Decision 2: 异步模式复用已有的 `member_done` → steer 机制

**选择**：`run_in_background=true` 时，创建独立 AgentSession 并 prompt，立即返回 bg_xxx ID。子 session 完成时，复用 `AgentServer.ensureSubscribed()` 中已有的 `member_done` → `session.steer(note)` 通知机制。

**理由**：
- Oracle 审查指出：`member_done` → steer 机制已完整实现（server/index.ts:179-194）
- 不需要新增 BackgroundManager（oh-my-openagent 的 BackgroundManager 是跨进程的，vc-agent 是 in-process）
- 复用现有通知路径减少代码量和维护面

**实现方式**：
- 新增 `TaskRegistry` 跟踪后台任务（bg_xxx → session 映射）
- 子 session subscribe 中，`agent_end` 事件触发 `TaskRegistry` 标记完成
- 复用 `AgentServer.ensureSubscribed()` 中的 steer/prompt 注入逻辑
- 新增 `background_output` 和 `background_cancel` 工具

### Decision 3: 同步模式使用 `await session.prompt()`，不轮询

**选择**：同步 task 沿用现有 `runSubagent()` 的 `await session.prompt()` 模式，完成后提取结果。

**理由**：
- Oracle 审查指出：`session.prompt()` 已是 awaitable，轮询 `isStreaming` 是多余的，且增加延迟
- 现有 `runSubagent()` 已验证此模式可行
- 100ms 轮询间隔是自我施加的瓶颈

**替代方案**：
- A) 轮询 isStreaming→Oracle 审查否决：冗余且增加延迟
- B) 事件驱动→复杂度高于 await，且 await 已满足需求

### Decision 4: 统一结果格式为 Markdown + `<task_metadata>`

**选择**：将 subagent 工具的结果从 XML `<subagent-result>` 格式改为 Markdown + `<task_metadata>` 块，对齐 oh-my-openagent 的 `buildSyncTaskCompletion` 格式。

**理由**：
- 对齐 oh-my-openagent 的结果格式，提高互操作性
- Markdown 格式在 TUI 中渲染更好（已有 markdown 组件）
- `<task_metadata>` 块提供机器可解析的结构化数据

**格式示例**：
```markdown
Task completed in 30s.

Agent: sisyphus-junior (category: deep)
Model: zhipuai-coding-plan/glm-5.2

---

[result text]

<task_metadata>
session_id: ses_xxx
task_id: bg_xxx
subagent: sisyphus-junior
category: deep
</task_metadata>
```

### Decision 5: 改进 SubagentMessageView 渲染，不新增组件

**选择**：改进现有 `SubagentMessageView` 组件的渲染逻辑，使其更紧凑、信息密度更高，对齐 opencode 的内联展示风格。不新增 SubtaskPartView 组件。

**理由**：
- Oracle 审查指出：已有 SubagentMessageView + WorkerMessageView 两条渲染路径，新增第三条（SubtaskPartView）增加复杂度
- 改进现有组件比新增组件更安全
- WorkerMessageView 已经是内联渲染的参考实现

**改进点**：
- 运行中：显示 spinner + agent/category + streaming tail（已有，保留）
- 完成时：显示 summary + cost + duration + turns（增强：添加 model 和 category 显示）
- 错误时：显示 error message（已有，保留）
- 整体风格：从独立卡片式向更紧凑的内联风格靠拢（减少 border padding，信息单行展示）

### Decision 6: 视角切换扩展 `activeMemberName` 机制

**选择**：复用已有的 `activeMemberName` + `handleMemberNav` + `[`/`]` 键机制，扩展支持 subagent 子 session。不使用 Tab 键。

**理由**：
- Oracle 审查指出：Tab 已绑定 `toggleAgentMode`（keymap.ts:39），直接冲突
- `[`/`]` 已是 member 导航键（keymap.ts:43-54），扩展到 subagent session 是自然延伸
- 现有 `activeMemberName` + `member.session.subscribe()` + `displayMessages` 派生链路完整，只需扩展数据源

**实现方式**：
- `handleMemberNav` 的候选列表从 `[null, ...members]` 扩展为 `[null, ...members, ...subagentSessions]`
- subagent session 在 TaskRegistry 中注册时，也加入候选列表
- 订阅逻辑复用：对 subagent session 的 `subscribe()` 与 member session 完全一致
- InputBox 的 perspective indicator 复用现有的 member 前缀显示

### Decision 7: TeamMember 工具集完整继承主 session

**选择**：重构 `TeamManager.createMember()` 中的工具配置逻辑，使 member session 完整继承主 session 的工具集（而非当前的受限子集），仅排除递归/特权工具（subagent、team、question）。

**理由**：
- 用户需求"子代理和主代理同能力"
- Oracle 审查指出：当前 `filterMemberTools` + `buildMemberCustomTools` 是手动配置的受限子集
- 完整继承 + 排除列表比白名单配置更简单、更不容易遗漏
- skill 和 MCP 继承通过 resourceLoader 和 McpManager 传递

**实现方式**：
- 复用 `createAgentSession()` 的主路径，传入与主 session 相同的 `tools` 白名单
- `NEVER_MEMBER_TOOLS`（subagent/team/question）作为排除列表
- `assignedSkills` 通过 resourceLoader 注入（已有）
- MCP 通过 McpManager 传递（已有 `resolveMcps`）
- 废弃 `filterMemberTools` + `buildMemberCustomTools` 的手动白名单逻辑

## Risks / Trade-offs

- **[Risk] 扩展 subagent 参数可能导致现有 agent prompt 不兼容** → Mitigation: 新增参数均为 optional，现有调用方式不受影响；`description` 语义不变
- **[Risk] subagent 异步模式的子 session 可能在主 session 切换时成为孤儿** → Mitigation: 复用 `AgentServer.setRebindSession` 中的 `cancelOrphansOnSessionChange` 逻辑，注册子 session 到同一个清理 hook
- **[Risk] member 完整继承工具集可能引入安全问题（如 edit 无确认）** → Mitigation: 保留 `permissionMode` 机制控制危险操作；question 工具仍在排除列表
- **[Trade-off] 不新增 SubtaskPartView** → 改进现有组件，视觉差异可能不如完全新建组件大，但维护成本更低
- **[Trade-off] 不实现 category→model 路由** → subagent 统一使用父 session 的 model，简化实现但失去模型分级

## Migration Plan

1. 扩展 `subagent` 工具参数 schema（向后兼容，新增字段均为 optional）
2. 实现 `run_in_background` 异步模式 + TaskRegistry + background_output/cancel 工具
3. 统一结果格式为 Markdown + `<task_metadata>`
4. 改进 SubagentMessageView 渲染
5. 扩展视角切换支持 subagent session
6. 重构 TeamMember 工具集继承
7. 每步完成后运行 `bun run check`
8. 回滚策略：所有改动向后兼容，无 breaking change

## Open Questions

- `category` 字段是否应该影响 prompt 构建（追加 category 特定提示），还是仅作为元数据标记？
- `subagent_type` 与现有 `agent` 字段如何统一？建议 `subagent_type` 作为 `agent` 的别名，内部映射到同一 agent 发现逻辑
