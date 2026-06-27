## MODIFIED Requirements

### Requirement: 创建 Pi SDK Agent 会话
系统 SHALL 调用 Pi SDK 的 `createAgentSession()` 创建 Agent 会话，配置内置工具（read、bash、edit、write）；SHALL 使用 `SettingsManager.inMemory()` 而非文件版创建 settings 管理器，阻止 Pi 写自己的 settings.json（持久化由 vc-agent 自行写 openagent/config.json，避免双写漂移）。

#### Scenario: 成功创建会话
- **WHEN** 系统启动且检测到有效的 LLM API Key（如 `ANTHROPIC_API_KEY`）
- **THEN** 调用 `createAgentSession({ cwd, model, tools, settingsManager })`，其中 `settingsManager` 为 `SettingsManager.inMemory(从 openagent/config.json 转换的初始 settings)`；返回 `session`

#### Scenario: 缺少 API Key
- **WHEN** 系统启动但未检测到任何 LLM API Key
- **THEN** 显示错误消息（"请设置 ANTHROPIC_API_KEY 或 OPENAI_API_KEY"），然后退出

#### Scenario: SDK 句柄链式访问
- **WHEN** settings 模块需要调用 SDK 句柄使设置项立即生效
- **THEN** SHALL 通过 `session.settingsManager`、`session.modelRegistry`、`session.modelRegistry.authStorage` 链式访问（这些已公开），不扩展 `createSession` 返回值

#### Scenario: Pi settings.json 不被写入
- **WHEN** `Setting.apply` 调用 Pi setter（如 `setDefaultThinkingLevel`）
- **THEN** 因 `SettingsManager` 为 inMemory 实例，SHALL 仅改内存使设置立即生效，不触发 Pi 写 `~/.pi/agent/settings.json` 或 `.pi/settings.json`
