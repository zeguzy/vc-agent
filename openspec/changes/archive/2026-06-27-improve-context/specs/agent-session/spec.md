## MODIFIED Requirements

### Requirement: 创建 Pi SDK Agent 会话
系统 SHALL 调用 Pi SDK 的 `createAgentSessionRuntime()` 创建一个 `AgentSessionRuntime` 承载当前会话；runtime 内部的 factory SHALL 调用 `createAgentSession()` 配置内置工具（read、bash、edit、write、grep、find）和 LSP 自定义工具（lsp_diagnostics、lsp_goto_definition、lsp_find_references），并使用纯内存 API（`AuthStorage.inMemory()`、`ModelRegistry.inMemory(authStorage)`、`SettingsManager.inMemory()`）创建 auth / model / settings 附属组件，不读取 Pi 磁盘配置；`SessionManager` SHALL 根据启动恢复意图选择模式（新建持久化 / continueRecent / open），不再固定 `inMemory()`。

#### Scenario: 成功创建 runtime
- **WHEN** 系统启动且检测到有效的 LLM API Key（如 `ANTHROPIC_API_KEY`）或 openagent config.json 中配置了 provider API key
- **THEN** 根据启动模式构造 `SessionManager`：new → `SessionManager.create(cwd, sessionDir)`；continue → `SessionManager.continueRecent(cwd, sessionDir)`；resume/session → `SessionManager.list` 匹配 id/path 后 `open`（详见 session-persistence 规格）
- **AND** 定义 runtime factory：接收 `{cwd, agentDir, sessionManager}`，内部用 `AuthStorage.inMemory()` / `ModelRegistry.inMemory(authStorage)` / `SettingsManager.inMemory(...)` 创建附属组件（不读取 Pi auth.json/models.json/settings.json），注入 `config.providers[name].apiKey`，初始化 SkillManager 和 LspClient，调用 `createAgentSession({cwd, model, tools, customTools, settingsManager, authStorage, modelRegistry, sessionManager})`
- **AND** `SettingsManager.inMemory(...)` SHALL 接收 compaction 设置（`reserveTokens` / `keepRecentTokens`）传入，当 `config.compaction` 提供了对应字段时覆盖 SDK 默认值
- **AND** 调用 `createAgentSessionRuntime(factory, {cwd, agentDir, sessionManager})` 返回 `runtime`，SDK 自动检测并恢复历史上下文（若 sessionManager 含历史数据）
- **AND** `createRuntime` 返回 `runtime`（而非裸 `session`），调用方（`index.tsx` / App）通过 `runtime.session` 访问当前会话

#### Scenario: LSP 自定义工具注入

- **WHEN** runtime factory 创建 Agent 会话
- **THEN** `customTools` 参数 SHALL 包含由 LspClient 生成的三个 ToolDefinition（lsp_diagnostics、lsp_goto_definition、lsp_find_references）
- **AND** 若 LspClient 初始化失败（如 typescript-language-server 不可用），customTools SHALL 为空数组，不影响其他工具

#### Scenario: 缺少 API Key
- **WHEN** 系统启动但未检测到任何 LLM API Key（环境变量及 config.providers 均无）
- **THEN** 显示错误消息（"请设置 ANTHROPIC_API_KEY 或 OPENAI_API_KEY"），然后退出

#### Scenario: SDK 句柄链式访问
- **WHEN** settings 模块或命令需要调用 SDK 句柄
- **THEN** SHALL 通过 `runtime.session.settingsManager`、`runtime.session.modelRegistry`、`runtime.session.modelRegistry.authStorage`、`runtime.session.sessionManager` 链式访问

#### Scenario: Pi 配置不被读取
- **WHEN** 系统启动创建 runtime
- **THEN** SHALL NOT 访问 `~/.pi/agent/` 目录下的任何文件
- **AND** 即使 `~/.pi/agent/` 目录存在，其内容 SHALL NOT 影响会话创建

#### Scenario: Pi settings.json 不被写入
- **WHEN** `Setting.apply` 调用 Pi setter
- **THEN** 因 `SettingsManager` 为 inMemory 实例，SHALL 仅改内存，不触发 Pi 写 `~/.pi/agent/settings.json`

#### Scenario: 会话数据不写入 pi 目录
- **WHEN** 系统创建或恢复会话
- **THEN** `SessionManager` 的 `sessionDir` SHALL 指向 `~/.config/openagent/sessions/`，会话 JSONL 文件 SHALL NOT 写入 `~/.pi/agent/sessions/`
