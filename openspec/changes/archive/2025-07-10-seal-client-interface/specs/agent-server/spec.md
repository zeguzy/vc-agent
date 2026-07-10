## MODIFIED Requirements

### Requirement: AgentServer handle methods for value-type API

AgentServer SHALL 新增以下 handle 方法以支持 AgentClient 的值类型 API：

- `handleSetModel(provider: string, id: string): Promise<void>`
- `handleGetAvailableThinkingLevels(): readonly string[]`
- `handleSetThinkingLevel(level: string): void`
- `handleGetUserMessagesForForking(): UserMessageSummary[]`
- `handleGetEntryParentId(entryId: string): string | undefined`
- `handleNavigateTree(parentId: string): Promise<NavigateResult>`
- `handleListSkills(): SkillListResult`
- `handleGetSkillDirectories(): SkillDirectories`
- `handleLoadDynamicSkill(path: string): Promise<LoadSkillResult>`
- `handleUnloadDynamicSkill(name: string): Promise<boolean>`
- `handleSetCompactionEnabled(enabled: boolean): void`
- `handleListModels(): ExtendedModelInfo[]`
- `handleFindModel(provider: string, id: string): ExtendedModelInfo | undefined`
- `handleHasAuthProvider(provider: string): boolean`
- `handleSetRuntimeApiKey(provider: string, key: string): void`

#### Scenario: Handle methods delegate to internal modules

- **WHEN** `handleSetModel("openai", "gpt-4o")` 被调用
- **THEN** Server 调用 `this.session.setModel({ provider: "openai", id: "gpt-4o" })`，不暴露 session 对象本身

#### Scenario: Handle methods return value types

- **WHEN** `handleListModels()` 被调用
- **THEN** Server 从 `this.session.modelRegistry.getAll()` 获取模型列表，映射为 `ExtendedModelInfo[]` 值类型数组返回
