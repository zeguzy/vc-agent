# agent-session Delta — add-skills-mcp-support

## MODIFIED Requirements

### Requirement: 创建 Pi SDK Agent 会话
系统 SHALL 调用 Pi SDK 的 `createAgentSession()` 创建 Agent 会话，配置内置工具（read、bash、edit、write）；SHALL 使用纯内存 API（`AuthStorage.inMemory()`、`ModelRegistry.inMemory(authStorage)`、`SettingsManager.inMemory()`）创建附属组件，不读取 Pi 磁盘配置（`~/.pi/agent/auth.json`、`~/.pi/agent/models.json`、`~/.pi/agent/settings.json`）。系统 SHALL 接受可选的 MCP 配置，在会话创建前初始化 MCP 连接并把桥接后的 MCP 工具通过 `customTools` 注入会话；SHALL 返回 `mcpManager` 供 UI 使用。

#### Scenario: 成功创建会话
- **WHEN** 系统启动且检测到有效的 LLM API Key（如 `ANTHROPIC_API_KEY`）或 openagent config.json 中配置了 provider API key
- **THEN** 调用 `AuthStorage.inMemory()` 创建凭据存储（不读取 Pi auth.json）
- **AND** 调用 `ModelRegistry.inMemory(authStorage)` 创建模型注册表（不读取 Pi models.json）
- **AND** 调用 `SettingsManager.inMemory(从 openagent/config.json 转换的初始 settings)` 创建 settings 管理器
- **AND** 若 `config.providers[name].apiKey` 存在，通过 `authStorage.setRuntimeApiKey()` 注入
- **AND** 调用 `createAgentSession({ cwd, model, tools, settingsManager, authStorage, modelRegistry, resourceLoader, customTools })` 返回 `session`

#### Scenario: 缺少 API Key
- **WHEN** 系统启动但未检测到任何 LLM API Key（环境变量及 config.providers 均无）
- **THEN** 显示错误消息（"请设置 ANTHROPIC_API_KEY 或 OPENAI_API_KEY"），然后退出

#### Scenario: SDK 句柄链式访问
- **WHEN** settings 模块需要调用 SDK 句柄使设置项立即生效
- **THEN** SHALL 通过 `session.settingsManager`、`session.modelRegistry`、`session.modelRegistry.authStorage` 链式访问（这些已公开），不扩展 `createSession` 返回值

#### Scenario: Pi 配置不被读取
- **WHEN** 系统启动创建 Agent 会话
- **THEN** SHALL NOT 访问 `~/.pi/agent/` 目录下的任何文件（auth.json、models.json、settings.json 等）
- **AND** 即使 `~/.pi/agent/` 目录存在，其内容 SHALL NOT 影响会话创建

#### Scenario: Pi settings.json 不被写入
- **WHEN** `Setting.apply` 调用 Pi setter（如 `setDefaultThinkingLevel`）
- **THEN** 因 `SettingsManager` 为 inMemory 实例，SHALL 仅改内存使设置立即生效，不触发 Pi 写 `~/.pi/agent/settings.json` 或 `.pi/settings.json`

#### Scenario: MCP 初始化与工具注入
- **WHEN** `createSession` 收到非空的 `mcpConfig`
- **THEN** 系统 SHALL 实例化 `McpManager`，连接所有 enabled server 并 discover 工具
- **AND** SHALL 把 MCP 工具桥接为 `ToolDefinition[]`，连同内置工具名一起通过 `customTools` 注入 `createAgentSession`
- **AND** 返回值 SHALL 包含 `mcpManager`（供 `/mcp` 面板使用）

#### Scenario: 无 MCP 配置时兼容
- **WHEN** `createSession` 未收到 `mcpConfig` 或 `mcpConfig` 为空
- **THEN** 系统 SHALL 跳过 MCP 初始化，`customTools` 为空数组或不传，返回值中 `mcpManager` 为空操作的占位实例，SHALL NOT 报错

#### Scenario: 返回值结构
- **WHEN** `createSession` 完成
- **THEN** SHALL 返回 `{ session, skillManager, mcpManager }`（在现有 `{ session, skillManager }` 基础上增加 `mcpManager`）
