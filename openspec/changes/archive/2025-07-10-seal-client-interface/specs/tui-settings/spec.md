## MODIFIED Requirements

### Requirement: SettingContext uses AgentClient only

SettingContext 类型 SHALL 移除以下内部对象字段：

- `session: AgentSession`
- `settingsManager: SettingsManager`
- `modelRegistry: ModelRegistry`
- `authStorage: AuthStorage`

SettingContext SHALL 保留 `client: AgentClient` 作为唯一操作通道。

#### Scenario: Setting apply functions use client methods

- **WHEN** 设置 apply 函数需要操作 session 或 model
- **THEN** 通过 `ctx.client.setModel()`、`ctx.client.setCompactionEnabled()` 等方法操作，不直接持有内部对象

#### Scenario: ModelPicker uses client methods

- **WHEN** ModelPicker 组件需要模型列表或认证状态
- **THEN** 通过 `client.listModels()`、`client.hasAuthProvider()` 等方法获取，不持有 ModelRegistry 或 AuthStorage 引用
