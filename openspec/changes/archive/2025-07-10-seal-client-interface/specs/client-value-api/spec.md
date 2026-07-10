## ADDED Requirements

### Requirement: Value-type API for session operations

系统 SHALL 在 AgentClient 接口上提供以下值类型方法替代 `getSession()` 内部对象 getter：

- `setModel(provider: string, id: string): Promise<void>` — 设置活跃模型
- `getAvailableThinkingLevels(): readonly string[]` — 获取可用的思考级别列表
- `setThinkingLevel(level: string): void` — 设置思考级别
- `getUserMessagesForForking(): UserMessageSummary[]` — 获取用于 undo 导航的用户消息摘要
- `getEntryParentId(entryId: string): string | undefined` — 获取指定 entry 的父节点 ID
- `navigateTree(parentId: string): Promise<NavigateResult>` — 导航到会话树的指定节点

#### Scenario: Undo command uses value-type API

- **WHEN** 用户执行 `/undo` 命令
- **THEN** 命令处理器调用 `client.getUserMessagesForForking()` 获取用户消息列表，调用 `client.getEntryParentId(entryId)` 获取父节点，调用 `client.navigateTree(parentId)` 执行导航，全程不持有 AgentSession 引用

#### Scenario: Model change uses value-type API

- **WHEN** 用户在设置面板切换模型
- **THEN** 设置 apply 函数调用 `client.setModel(provider, id)` 设置模型，调用 `client.getAvailableThinkingLevels()` 获取思考级别选项，调用 `client.setThinkingLevel(level)` 设置思考级别

### Requirement: Value-type API for skill operations

系统 SHALL 在 AgentClient 接口上提供以下值类型方法替代 `getSkillManager()` 内部对象 getter：

- `listSkills(): SkillListResult` — 列出所有已加载技能
- `getSkillDirectories(): SkillDirectories` — 获取技能搜索目录
- `loadDynamicSkill(path: string): Promise<LoadSkillResult>` — 加载动态技能
- `unloadDynamicSkill(name: string): Promise<boolean>` — 卸载动态技能

#### Scenario: Skills command uses value-type API

- **WHEN** 用户执行 `/skills` 命令
- **THEN** 命令处理器调用 `client.listSkills()` 和 `client.getSkillDirectories()` 获取技能信息，全程不持有 SkillManager 引用

#### Scenario: Skill autocomplete uses value-type API

- **WHEN** 用户在输入框中输入 `/skill:` 前缀
- **THEN** 自动补全使用 `client.listSkills()` 返回的技能列表生成建议，不持有 SkillManager 引用

### Requirement: Value-type API for model and auth operations

系统 SHALL 在 AgentClient 接口上提供以下值类型方法替代 `getModelRegistry()` 和 `getAuthStorage()` 内部对象 getter：

- `listModels(): ExtendedModelInfo[]` — 列出所有可用模型（含 provider/reasoning/input 字段）
- `findModel(provider: string, id: string): ExtendedModelInfo | undefined` — 按 provider:id 查找模型
- `hasAuthProvider(provider: string): boolean` — 检查 provider 是否已配置 API key
- `setRuntimeApiKey(provider: string, key: string): void` — 运行时设置 API key

#### Scenario: Model picker uses value-type API

- **WHEN** 用户打开模型选择器
- **THEN** ModelPicker 调用 `client.listModels()` 获取模型列表，调用 `client.hasAuthProvider(provider)` 检查认证状态，调用 `client.setRuntimeApiKey(provider, key)` 设置 API key，全程不持有 ModelRegistry 或 AuthStorage 引用

### Requirement: Value-type API for settings operations

系统 SHALL 在 AgentClient 接口上提供以下值类型方法替代 `getSettingsManager()` 内部对象 getter：

- `setCompactionEnabled(enabled: boolean): void` — 切换自动压缩开关

#### Scenario: Settings panel uses value-type API

- **WHEN** 用户在设置面板切换自动压缩
- **THEN** 设置 apply 函数调用 `client.setCompactionEnabled(enabled)` 切换开关，不持有 SettingsManager 引用

### Requirement: Value-type definitions

系统 SHALL 定义以下值类型用于 AgentClient 方法的返回值：

- `UserMessageSummary` — 包含 `entryId: string` 和 `text: string`
- `NavigateResult` — 包含 `cancelled: boolean` 和可选 `lastUserText?: string`
- `SkillListResult` — 包含 `skills` 数组，每个元素含 `name`/`description`/`source`/`disableModelInvocation`/`filePath?`
- `SkillDirectories` — 包含 `global: string` 和 `project: string`
- `LoadSkillResult` — 包含 `name`/`description`/`filePath`/`disableModelInvocation`
- `ExtendedModelInfo` — 继承 `ModelInfo`，新增 `provider: string`/`reasoning?: boolean`/`input?: number`

#### Scenario: Value types are serializable

- **WHEN** HttpClient 通过 REST 端点调用 AgentClient 方法
- **THEN** 所有返回值类型都是纯数据（无类实例、无函数、无循环引用），可以 JSON 序列化传输
