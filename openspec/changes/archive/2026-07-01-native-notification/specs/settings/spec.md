## ADDED Requirements

### Requirement: 通知配置项注册到 Setting 注册表
系统 SHALL 在 `src/settings/` 下为 `notifications` 配置块注册顶层设置项，纳入 `settings` 数组注册表，使 `/setting` 页面可枚举与编辑。

#### Scenario: 总开关 Setting
- **WHEN** 新增 `notifications.enabled` 设置项
- **THEN** SHALL 在 `src/settings/notifications-enabled.ts`（或同级独立文件）实现 `Setting<boolean>`，`key` 为 `"notifications.enabled"`，`label` 为 `"通知"`，`category` 归入合适分组，`defaultValue` 为 `true`，`scope` 默认项目级

#### Scenario: 声音开关 Setting
- **WHEN** 新增 `notifications.sound` 设置项
- **THEN** SHALL 实现 `Setting<boolean>`，`key` 为 `"notifications.sound"`，`defaultValue` 为 `true`

#### Scenario: bash 阈值 Setting
- **WHEN** 新增 `notifications.bashThresholdSeconds` 设置项
- **THEN** SHALL 实现 `Setting<number>`，`key` 为 `"notifications.bashThresholdSeconds"`，`defaultValue` 为 `10`（秒），`edit` 接受数字输入

#### Scenario: 注册表枚举
- **WHEN** `/setting` 页面或命令枚举设置项
- **THEN** `settings` 数组 SHALL 包含上述三个 notifications 相关 Setting，按 `category` 分组渲染

#### Scenario: 细粒度开关不进页面
- **WHEN** 用户需调整 `events.*` 或 `channels.*` 细粒度开关
- **THEN** `/setting` 页面 SHALL NOT 暴露这些子项；用户 SHALL 通过直接编辑 config.json 修改（文档说明）

### Requirement: 通知配置走现有 apply + persist 模式
系统 SHALL 让 notifications 相关 Setting 通过现有 `apply(value, ctx)` + `persist(config, value)` 模式生效与持久化，与其他 Setting 行为一致。

#### Scenario: 修改总开关立即生效
- **WHEN** 用户在 `/setting` 页面将 `notifications.enabled` 从 `true` 改为 `false`
- **THEN** `apply` SHALL 立即更新运行时 NotificationRouter 的开关状态，`persist` SHALL 写入 config.json，后续事件不再触发通知

#### Scenario: 持久化路径遵循 scope
- **WHEN** Setting 未声明 `scope`
- **THEN** `persist` SHALL 默认写入项目级 `.openagent/config.json`；声明 `scope: "global"` 时 SHALL 写入 `~/.config/openagent/config.json`

#### Scenario: persist 失败不回滚生效
- **WHEN** `writeConfig` 失败
- **THEN** SHALL NOT 回滚已执行的 `apply`，SHALL 向用户提示「已生效但未持久化」，不静默吞错（沿用现有 Setting 契约）
