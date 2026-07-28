## ADDED Requirements

### Requirement: SubAgentService 注册表与生命周期

系统 SHALL 提供 `src/agents/sub-agent-service.ts` 模块，导出 `SubAgentService` 类作为进程级 sub-agent 注册表。`SubAgentService` 的接口设计 SHALL 参照 `BackgroundJobService`（`src/background/service.ts`）的生命周期模式，但不继承（因 sub-agent session 类型与 Pi SDK `AgentSession` 不兼容）。`SubAgentService` SHALL 维护 `Map<string, SubAgentSession>` 注册表，提供 `start(opts)` / `get(id)` / `list()` / `cancel(id)` / `dispose()` 方法。并发 sub-agent 数量 SHALL 不超过 `MAX_BG_JOBS`（8），超限时 `start()` 抛错。

#### Scenario: 创建 sub-agent session
- **WHEN** 主 agent 调用 `tmux_agent` 工具创建 sub-agent（type: "opencode", prompt: "fix the bug"）
- **THEN** `SubAgentService.start()` SHALL 生成唯一 ID，创建 `SubAgentSession` 记录（status: "running"），委托对应 `SubAgentAdapter` 执行 prompt
- **AND** SHALL 返回 `{ id, status: "running" }`

#### Scenario: 查询 sub-agent 状态
- **WHEN** 调用 `get(id)`
- **THEN** SHALL 返回对应的 `SubAgentSession`（含 status / lastOutput / error），不存在时返回 `undefined`

#### Scenario: 列举所有 sub-agent
- **WHEN** 调用 `list()`
- **THEN** SHALL 返回所有 `SubAgentSession[]` 数组

#### Scenario: 取消 sub-agent
- **WHEN** 调用 `cancel(id)` 且 session 状态为 "running"
- **THEN** SHALL 调用 adapter 的 `abort(sessionId)` 中止
- **AND** 标记 status 为 "cancelled"，completedAt 为当前时间戳

#### Scenario: 并发上限
- **WHEN** 运行中的 sub-agent 数量已达 `MAX_BG_JOBS`（8）
- **AND** 再次调用 `start()`
- **THEN** SHALL 抛错 `Error("sub-agent capacity reached (max 8)")`

### Requirement: SubAgentSession 数据结构

系统 SHALL 定义 `SubAgentSession` 接口，包含以下字段：`id: string`（vcagent 侧唯一 ID）、`name: string`（人类可读名）、`type: "opencode"`（首期只有 opencode，预留扩展）、`status: "running" | "completed" | "error" | "cancelled"`、`startedAt: number`、`completedAt: number | null`、`httpSessionId?: string`（opencode session ID）、`paneId?: string`（tmux pane，可选）、`lastOutput: string | null`（结构化输出摘要）、`error: string | null`。

#### Scenario: 字段完整性
- **WHEN** 创建一个 SubAgentSession
- **THEN** SHALL 包含上述所有字段，`startedAt` 为创建时间戳，`completedAt` 初始为 `null`，`lastOutput` 初始为 `null`，`error` 初始为 `null`

### Requirement: SubAgentAdapter 抽象接口

系统 SHALL 在 `src/agents/adapters/types.ts` 定义 `SubAgentAdapter` 接口，包含方法：`createSession(name: string): Promise<{ sessionId: string }>`、`prompt(sessionId: string, text: string): Promise<{ output: string; parts: unknown[] }>`、`abort(sessionId: string): Promise<void>`、`dispose(sessionId: string): Promise<void>`。该接口 SHALL 允许未来新增 `ClaudeAdapter` / `CodexAdapter` 实现而无需修改 `SubAgentService`。

#### Scenario: 接口实现
- **WHEN** 定义新的 sub-agent adapter（如 ClaudeAdapter）
- **THEN** SHALL 实现 `SubAgentAdapter` 接口的所有方法
- **AND** `SubAgentService` 通过接口调用，不感知具体实现类型

### Requirement: OpencodeAdapter 实现

系统 SHALL 在 `src/agents/adapters/opencode.ts` 提供 `OpencodeAdapter` 类，实现 `SubAgentAdapter` 接口，基于 `@opencode-ai/sdk` 的 `createOpencodeClient({ baseUrl })`。`baseUrl` SHALL 从配置 `config.subAgent.opencodeServeUrl` 读取（默认 `http://localhost:4096`）。`createSession` SHALL 调用 `client.session.create({ body: { title: name } })`。`prompt` SHALL 调用 `client.session.prompt({ path: { id: sessionId }, body: { parts: [{ type: "text", text }] } })`，返回 `{ output, parts }`，其中 `output` 为 `parts` 中 text 类型 part 的拼接摘要。`abort` SHALL 调用 `client.session.abort({ path: { id: sessionId } })`。

#### Scenario: 创建 opencode session
- **WHEN** 调用 `createSession("fix-auth-bug")`
- **THEN** SHALL 调用 `client.session.create({ body: { title: "fix-auth-bug" } })`
- **AND** 返回 `{ sessionId: "<opencode-session-id>" }`

#### Scenario: 发送 prompt
- **WHEN** 调用 `prompt(sessionId, "fix the bug in auth.ts")`
- **THEN** SHALL 调用 `client.session.prompt({ path: { id: sessionId }, body: { parts: [{ type: "text", text: "fix the bug in auth.ts" }] } })`
- **AND** 返回 `{ output: "<text parts 拼接>", parts: [<原始 Part 数组>] }`

#### Scenario: serve 未运行
- **WHEN** `opencode serve` 未启动，HTTP 连接失败
- **THEN** `createSession` SHALL 抛出含明确错误信息的 Error（"opencode serve 未启动，请先运行 `opencode serve`，或检查 config.subAgent.opencodeServeUrl 配置"）

### Requirement: tmux_agent 工具定义

系统 SHALL 在 `src/tools/tmux-agent.ts` 提供 `createTmuxAgentTool` 工厂函数，返回 Pi SDK `ToolDefinition`。工具名 SHALL 为 `tmux_agent`，支持三种 action：`create`（创建 sub-agent）、`status`（查询状态或列举）、`cancel`（取消 sub-agent）。工具参数 SHALL 使用 TypeBox schema 定义。工具 SHALL 通过 `SubAgentService` 实例操作。

#### Scenario: create action 参数 schema
- **WHEN** 定义 `tmux_agent` 工具的 parameters
- **THEN** schema SHALL 为 `Type.Object({ action: Type.Literal("create"), type: Type.Literal("opencode"), name: Type.String(), prompt: Type.String() })` 或 `Type.Object({ action: Type.Union([Type.Literal("status"), Type.Literal("cancel")]), id: Type.Optional(Type.String()) })`

#### Scenario: create action 执行
- **WHEN** Agent 调用 `tmux_agent`，action 为 "create"，type 为 "opencode"，prompt 为 "fix the bug"
- **THEN** 工具 SHALL 调用 `SubAgentService.start({ type: "opencode", name, run: () => adapter.prompt(...) })`
- **AND** 返回 `AgentToolResult`，content 为包含 `{ id, status }` 的文本

#### Scenario: status action 列举
- **WHEN** Agent 调用 `tmux_agent`，action 为 "status"，未传 id
- **THEN** 工具 SHALL 调用 `SubAgentService.list()` 返回所有 sub-agent 的摘要

#### Scenario: serve 未运行的错误处理
- **WHEN** `OpencodeAdapter` 初始化失败（serve 未运行）
- **AND** Agent 调用 `tmux_agent` action 为 "create"
- **THEN** 工具 SHALL 返回 `isError: true` 的 `AgentToolResult`，content 含明确错误信息和修复指引
