## ADDED Requirements

### Requirement: Agent 定义 frontmatter 扩展字段

系统 SHALL 在 `src/agents/discover.ts:loadAgentsFromDir` 与 `src/agents/types.ts:AgentDefinition` 解析以下 frontmatter 字段为可选：`disallowedTools?: string[]` / `maxTurns?: number` / `background?: boolean` / `permissionMode?: "default" | "plan" | "acceptEdits"`（V1 不允许 `"bypass"`，校验失败跳过 agent 并 warn——详见下方 Scenario `permissionMode 枚举拒收 bypass`）。未声明时分别采用：`[]` / `Config.teams.defaultMaxTurns`（默认 8）/ `false` / `"default"`。

#### Scenario: 解析 disallowedTools 字段
- **WHEN** agent frontmatter 含 `disallowedTools: [write, edit]`
- **THEN** `AgentDefinition.disallowedTools` SHALL 为 `["write", "edit"]`
- **AND** 后续 `runSubagent` 与 `WorkerSessionPool.spawnWorker` SHALL 在应用 `tools` allowlist 之前先从工具集中移除上述工具

#### Scenario: 解析 maxTurns 字段
- **WHEN** agent frontmatter 含 `maxTurns: 20`
- **THEN** `AgentDefinition.maxTurns` SHALL 为 `20`
- **AND** 用作 worker 时 SHALL 覆盖 `Config.teams.defaultMaxTurns`；作为同步 subagent 时 SHALL 与现有 `chain` / `parallel` 模式无关（同步 subagent 仍受 SDK 默认限制）

#### Scenario: 解析 background 字段
- **WHEN** agent frontmatter 含 `background: true`
- **THEN** `AgentDefinition.background` SHALL 为 `true`
- **AND** 该 agent 才能被 `team.spawn` 工具或 `/team spawn` 命令作为异步 worker spawn
- **AND** `background: false` 或未声明的 agent 被 `team.spawn` 时 SHALL 返回 isError：`"agent <name> is not background-capable"`

#### Scenario: 解析 permissionMode 字段
- **WHEN** agent frontmatter 含 `permissionMode: plan`
- **THEN** SHALL 强制 worker / subagent 只读：所有 `write`/`edit`/`bash` 的可能修改路径 SHALL 被禁用
- **AND** 等价运行时只激活 `STANDARD_ACTIVE_TOOLS` 减去 `["write", "edit", "bash"]` 的子集

#### Scenario: 未声明字段保留默认
- **WHEN** agent frontmatter 未声明任何上述四个字段
- **THEN** `AgentDefinition.disallowedTools = []`、`maxTurns = Config.teams.defaultMaxTurns`（默认 8）、`background = false`、`permissionMode = "default"`
- **AND** 现有 agent 定义文件**无需改写**，零迁移成本

#### Scenario: permissionMode 枚举拒收 bypass
- **WHEN** agent frontmatter 含 `permissionMode: bypass` 或不属于 `"default" | "plan" | "acceptEdits"` 的其他取值
- **THEN** `src/agents/discover.ts` YAML 解析 SHALL 视为非法、跳过该 agent 并 stderr 输出 warn `agent <name> permissionMode must be one of default|plan|acceptEdits, got "<value>"`
- **AND** V1 不允许 `bypass` 取值的约束 SHALL 在 `discover.ts` 枚举校验处强制；`bypass` 留待 V2 提案独立设计权限模型时再评估其必要性

### Requirement: Worker session 创建路径（异步起点）

系统 SHALL 在 `src/teams/worker.ts` 提供 `Worker.spawn(opts)` 静态工厂，**先直接在 worker.ts 内创建独立 `createAgentSession`**（不立刻抽出 `src/agents/runner.ts:runSubagent` 共享工厂），关键改造是把 `session.prompt(task)` 改成 fire-and-track 而非 await。事后通过 tasks 14.2 重构 `runSubagent` 与 `Worker.spawn` 共享工厂。

#### Scenario: spawn 不阻塞主 agent 工具调用
- **WHEN** `Worker.spawn({agent, task, cwd, services, parentModel, signal?})` 被调用
- **THEN** SHALL 内部 `createAgentSession` 创建独立会话，配置：
  - `cwd`（与主 session 同一）
  - `authStorage` / `modelRegistry` / `settingsManager` 复用主会话的 `services`
  - `model`: `agent.model ? resolveModel(services.modelRegistry, agent.model) : parentModel`
  - `tools`: 解析 `agent.tools` allowlist（应用 `disallowedTools` deny 后再应用 `tools` 允许）
  - `resourceLoader`: `new DefaultResourceLoader({cwd, agentDir, settingsManager, appendSystemPrompt: [agent.systemPrompt], noSkills: true, noContextFiles: true, noExtensions: true})`
- **AND** SHALL 注册 `session.subscribe()` 转发事件到 `WorkerSessionPool`
- **AND** SHALL **不 await** `session.prompt(task)`；调用方法立即返回 Worker 实例
- **AND** prompt 的 promise 异步 settle 时（done / error / cancelled）SHALL 更新 worker.status 并 emit 对应 kind 事件

#### Scenario: worker 默认禁用 write/edit
- **WHEN** agent frontmatter 未显式声明允许 `edit` 或 `write` 工具
- **THEN** 实际激活工具集 SHALL 从 `agent.tools ?? BUILTIN_TOOLS` 中过滤掉 `["write", "edit"]`
- **AND** 同步 subagent `runSubagent` 调用路径 SHALL 与现有行为保持一致（不引入回退）

#### Scenario: worker 模型解析回退父模型
- **WHEN** agent frontmatter 未声明 `model` 字段
- **THEN** worker session SHALL 使用创建时传入的 `parentModel`（主 session 当前 model）
- **AND** parentModel 为 `undefined` 时 SHALL 走 SDK 默认解析路径

#### Scenario: worker 单点失败不传染 pool
- **WHEN** 某 worker 的 prompt promise reject（如 LLM 限流 / 网络 drop / API timeout）
- **THEN** `Worker.run()` 的 `try { await session.prompt(task) } catch (e) { ... }` 路径 SHALL 是唯一 error 转换点
- **AND** worker.status 置为 `error`、`lastError` 记录 `error.message`（兜底为 `error.toString()`）
- **AND** SHALL emit `kind: "error"` 事件，payload `{reason: "prompt_rejected", message: <error.message>}`
- **AND** `WorkerSessionPool` 中其他 worker SHALL 不受影响

#### Scenario: worker 不共享主 session 的 EditConfirmBridge
- **WHEN** agent frontmatter `permissionMode: "acceptEdits"` 且 `tools` 显式声明包含 `edit` 或 `write`
- **THEN** worker 的 `createAgentSession` SHALL 注入 SDK 内置 `edit` / `write` 工具（不通过 `createEditTool`/`editBridge` 包装），底层 fsWriteFile 直写不弹确认 UI
- **AND** worker SHALL NOT 持有对主 session `runtime.factory` 闭包内 `editBridge` / `QuestionBridge` 的任何引用
- **AND** 与现有 headless 模式行为对齐（无 TUI 时主 session 也是直写路径）

#### Scenario: worker 不注入 question 工具
- **WHEN** worker 构造 active tools 时遍历候选工具名
- **THEN** `question` SHALL NOT 出现在 worker 激活工具列表中（即便 agent frontmatter `tools` 数组显式列了 `question`，也 SHALL 被强制过滤）
- **AND** 若 worker LLM 因任何路径调用 question：worker SHALL 返回 `isError: true` 工具结果 `Error("question tool unavailable in worker context")`，主 agent 在 `team.poll` 中能识别该 error
- **AND** 此约束 SHALL 实现于 `src/teams/worker.ts` worker active tools 构造点

#### Scenario: worker 不注入 LSP 工具避免并发压力
- **WHEN** worker 构造 active tools 时遍历候选工具名
- **THEN** `lsp_diagnostics` / `lsp_goto_definition` / `lsp_find_references` SHALL NOT 出现在 worker 激活工具列表中（即便 agent frontmatter `tools` 数组显式列了这些名字）
- **AND** worker 不创建独立 `LspClient` 实例，也不持主 session `LspClient` 引用
- **AND** 此约束 SHALL 实现于 `src/teams/worker.ts`，并在 frontmatter `tools` 含 LSP 工具名时 stderr 输出 warn `agent <name> claims lsp tools but workers do not support them in V1`

#### Scenario: worker 不允许嵌套 team 调用
- **WHEN** worker LLM 调用 `team` 工具（任何 action）
- **THEN** `team` 工具 SHALL 检测调用栈是否处于 worker session（通过 `WorkerPoolRef.current` 与当前 session id 比对）
- **AND** 在 worker 上下文中 SHALL 返回 `isError: true` 工具结果 `nested team calls are forbidden`，主 agent 在 `team.poll` 时识别该 worker stuck on forbidden action 并取消


### Requirement: 主 session 切换时 worker 生命周期

系统 SHALL 在 `AgentServer.abendHandler` 处理主 session 切换钩子时检查 worker pool 生命周期。`Config.teams.cancelOrphansOnSessionChange` 默认 `true`：主 session `switchSession` / `newSession` 触发时自动 `workerPool.cancelAll()` 并 emit `team_orphans_cancelled`；显式设为 `false` 时 worker 跨主 session 保持运行（但 worker 与新主 session 上下文孤绝，需用户自行 `team.poll` 闭合）。

#### Scenario: 主 session 切换默认取消 running worker
- **WHEN** 主 agent 调用 `runtime.switchSession(path)` 或 `runtime.newSession()` 触发 SDK `setRebindSession` 回调
- **AND** `Config.teams.cancelOrphansOnSessionChange !== false`（默认 true）
- **THEN** `AgentServer` SHALL 在 rebind 钩子内同步调 `workerPool.cancelAll()`
- **AND** SHALL emit `team_orphans_cancelled` 事件，payload `workerIds: [取消的 worker id 列表]`
- **AND** TUI SHALL 在新 session 主消息流末显示提示行 `[N orphan workers cancelled due to session change]`

#### Scenario: 主 session 切换保留 running worker
- **WHEN** `Config.teams.cancelOrphansOnSessionChange === false`
- **THEN** SHALL 不自动 cancelAll，worker 在新主 session 上下文中继续后台执行
- **AND** 进程退出钩子 SHALL 仍保证 `workerPool.disposeAll()` 在 `process.on("exit")` 触发
- **AND** TUI SHALL 在新 session StatusBar 显示提示 `teams: N orphan worker(s) still running in old session context`