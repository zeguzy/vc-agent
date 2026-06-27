## MODIFIED Requirements

### Requirement: 创建 Pi SDK Agent 会话
系统 SHALL 调用 Pi SDK 的 `createAgentSession()` 创建 Agent 会话，配置内置工具（read、bash、edit、write）；SHALL 使用纯内存 API（`AuthStorage.inMemory()`、`ModelRegistry.inMemory(authStorage)`、`SettingsManager.inMemory()`）创建附属组件，不读取 Pi 磁盘配置（`~/.pi/agent/auth.json`、`~/.pi/agent/models.json`、`~/.pi/agent/settings.json`）。

#### Scenario: 成功创建会话
- **WHEN** 系统启动且检测到有效的 LLM API Key（如 `ANTHROPIC_API_KEY`）或 openagent config.json 中配置了 provider API key
- **THEN** 调用 `AuthStorage.inMemory()` 创建凭据存储（不读取 Pi auth.json）
- **AND** 调用 `ModelRegistry.inMemory(authStorage)` 创建模型注册表（不读取 Pi models.json）
- **AND** 调用 `SettingsManager.inMemory(从 openagent/config.json 转换的初始 settings)` 创建 settings 管理器
- **AND** 若 `config.providers[name].apiKey` 存在，通过 `authStorage.setRuntimeApiKey()` 注入
- **AND** 调用 `createAgentSession({ cwd, model, tools, settingsManager, authStorage, modelRegistry })` 返回 `session`

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
