## MODIFIED Requirements

### Requirement: App 组件模块依赖

系统 SHALL 在 `tui/App.tsx` 中从 `message.ts`（原 `store.ts`）导入消息模型和工厂函数。导入路径 SHALL 为 `../message.js`。

#### Scenario: 消息模型导入

- **WHEN** App.tsx 引用 Message 类型或工厂函数
- **THEN** 导入语句 SHALL 使用 `../message.js`，不再使用 `../store.js`
- **AND** `bun run check` SHALL 无类型错误

### Requirement: 会话恢复的历史消息渲染

系统 SHALL 在 `session/render.ts` 中通过 `mapSdkMessagesToTui` 将 SDK 消息映射为 TUI Message。该函数 SHALL 从 `../message.js`（原 `../store.js`）导入工厂函数。

#### Scenario: 渲染模块导入

- **WHEN** `session/render.ts` 引用消息工厂函数
- **THEN** 导入语句 SHALL 使用 `../message.js`
- **AND** 函数行为 SHALL 保持不变（纯重构）
