## MODIFIED Requirements

### Requirement: 创建 Pi SDK Agent 会话

系统 SHALL 调用 Pi SDK 的 `createAgentSessionRuntime()` 创建一个 `AgentSessionRuntime` 承载当前会话；runtime 内部的 factory SHALL 调用 `createAgentSession()` 配置内置工具（read、bash、edit、write、grep、find）**和 LSP 自定义工具（lsp_diagnostics、lsp_goto_definition、lsp_find_references）**，并使用纯内存 API（`AuthStorage.inMemory()`、`ModelRegistry.inMemory(authStorage)`、`SettingsManager.inMemory()`）创建 auth / model / settings 附属组件，不读取 Pi 磁盘配置；`SessionManager` SHALL 根据启动恢复意图选择模式（新建持久化 / continueRecent / open），不再固定 `inMemory()`。

#### Scenario: 成功创建 runtime

- **WHEN** 系统启动且检测到有效的 LLM API Key（如 `ANTHROPIC_API_KEY`）或 openagent config.json 中配置了 provider API key
- **THEN** 根据启动模式构造 `SessionManager`：new → `SessionManager.create(cwd, sessionDir)`；continue → `SessionManager.continueRecent(cwd, sessionDir)`；resume/session → `SessionManager.list` 匹配 id/path 后 `open`（详见 session-persistence 规格）
- **AND** 定义 runtime factory：接收 `{cwd, agentDir, sessionManager}`，内部用 `AuthStorage.inMemory()` / `ModelRegistry.inMemory(authStorage)` / `SettingsManager.inMemory(...)` 创建附属组件（不读取 Pi auth.json/models.json/settings.json），注入 `config.providers[name].apiKey`，初始化 SkillManager **和 LspManager**，调用 `createAgentSession({cwd, model, tools, customTools, settingsManager, authStorage, modelRegistry, sessionManager})`
- **AND** 调用 `createAgentSessionRuntime(factory, {cwd, agentDir, sessionManager})` 返回 `runtime`，SDK 自动检测并恢复历史上下文（若 sessionManager 含历史数据）
- **AND** `createRuntime` 返回 `runtime`（而非裸 `session`），调用方（`index.tsx` / App）通过 `runtime.session` 访问当前会话

#### Scenario: LSP 自定义工具注入

- **WHEN** runtime factory 创建 Agent 会话
- **THEN** `customTools` 参数 SHALL 包含由 LspManager 生成的三个 ToolDefinition
- **AND** 若 LspManager 初始化失败（如语言服务器不可用），customTools SHALL 为空数组，不影响其他工具
