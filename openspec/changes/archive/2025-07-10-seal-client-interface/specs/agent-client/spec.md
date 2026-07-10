## MODIFIED Requirements

### Requirement: Remove internal object getters from AgentClient

AgentClient 接口 SHALL 移除以下 6 个内部对象 getter：

- `getSession(): AgentSession`
- `getRuntime(): AgentSessionRuntime`
- `getSkillManager(): SkillManager`
- `getSettingsManager(): SettingsManager`
- `getModelRegistry(): ModelRegistry`
- `getAuthStorage(): AuthStorage`

#### Scenario: TUI cannot access internal objects

- **WHEN** TUI 代码尝试调用已移除的 getter（如 `client.getSession()`）
- **THEN** TypeScript 编译器报错，阻止编译通过

#### Scenario: HttpClient implements all methods

- **WHEN** 远程客户端通过 HttpClient 调用任何 AgentClient 方法
- **THEN** 不抛出 NotSupportedError，所有方法通过 REST 端点正常工作
