# settings Specification

## Purpose
TBD - created by archiving change add-settings-module. Update Purpose after archive.
## Requirements
### Requirement: 设置项自包含抽象
系统 SHALL 把每个设置项建模为一个自包含对象（实现 `Setting<T>` 接口），在同一处声明其属性（`key`/`label`/`category`/`scope`/`defaultValue`）与维护能力（`read`/`renderValue`/`edit`/`apply`/`persist`）。

#### Scenario: Setting 接口字段
- **WHEN** 定义一个设置项
- **THEN** 该对象 SHALL 实现 `Setting<T>` 接口，至少包含 `key`、`label`、`category`、`defaultValue`、`read(config)`、`renderValue(v)`、`edit(current)`、`apply(value, ctx)`、`persist(config, value)` 字段；`scope` 为可选字段

#### Scenario: scope 默认与覆盖
- **WHEN** 设置项未声明 `scope`
- **THEN** 持久化时 SHALL 默认写项目级（`.openagent/config.json`）
- **AND** 设置项声明 `scope: "global"` 时 SHALL 写全局级（`~/.config/openagent/config.json`）

#### Scenario: 设置项独立文件
- **WHEN** 新增一个设置项
- **THEN** SHALL 在 `src/settings/` 下新建独立文件，不修改其他设置项文件

#### Scenario: 注册表为唯一枚举源
- **WHEN** `/setting` 页面或命令需枚举设置项
- **THEN** SHALL 从 `src/settings/registry.ts` 导出的 `settings` 数组读取，该数组是设置项的唯一注册源

### Requirement: 设置项变更立即生效
系统 SHALL 在设置项值变更时，通过 `apply(value, ctx)` 立即应用到运行时。`SettingContext` SHALL 提供 `session`、`authStorage`、`modelRegistry`、`settingsManager` 句柄及 `setUi` 回调（用于 UI 偏好类）。

#### Scenario: UI 偏好类立即生效
- **WHEN** 修改 UI 偏好类设置项（如 `thinking.collapsed`、`display.contextMode`）
- **THEN** `apply` SHALL 通过 `ctx.setUi` 调用对应 setState，立即反映在界面

#### Scenario: 会话能力类立即生效
- **WHEN** 修改会话能力类设置项（如 `model`、`thinking.level`、`providers.*.apiKey`）
- **THEN** `apply` SHALL 通过 `ctx` 的 SDK 句柄（`session`/`authStorage`/`modelRegistry`/`settingsManager`）调用对应接口立即生效，不打断进行中的对话（下次 prompt 起效）

#### Scenario: 不支持立即生效的标注
- **WHEN** 某 SDK 接口经 spike 确认不支持运行时修改
- **THEN** 该 Setting SHALL 在页面标注"重启生效"，`apply` 为空操作，仅 `persist` 写盘

### Requirement: 设置项变更立即持久化
系统 SHALL 在设置项 `apply` 后，立即通过 `persist(config, value)` 得到不可变新 Config，并由调用方 `writeConfig` 写盘。

#### Scenario: 改即写盘
- **WHEN** 设置项变更
- **THEN** SHALL 调用 `persist(config, value)` 返回新 Config，并立即 `writeConfig` 到对应作用域路径

#### Scenario: 持久化失败不回滚生效
- **WHEN** `writeConfig` 失败（权限/磁盘满）
- **THEN** SHALL 不回滚已执行的 `apply`，向用户明确提示"已生效但未持久化"，不静默吞错

### Requirement: /setting 设置页面
系统 SHALL 提供 `/setting` 命令打开全屏设置页面，App 顶层通过 `view: "chat" | "settings"` 状态在两个视图间切换。

#### Scenario: 打开设置页面
- **WHEN** 用户执行 `/setting` 命令
- **THEN** App 的 `view` SHALL 切换为 `"settings"`，整屏渲染 `SettingsPage`

#### Scenario: 关闭设置页面
- **WHEN** 用户在设置页面按 `Esc`
- **THEN** `view` SHALL 切换回 `"chat"`

#### Scenario: 列表分组渲染
- **WHEN** 渲染 `SettingsPage`
- **THEN** SHALL 遍历 `registry` 的 `settings` 数组，按 `category` 分组，每行显示 `label` 与 `renderValue(currentValue)`，当前选中项用标记区分

#### Scenario: j/k 导航
- **WHEN** 用户按 `j`/`k`
- **THEN** SHALL 上下移动选中项

#### Scenario: Enter 编辑
- **WHEN** 用户在选中项按 `Enter`
- **THEN** SHALL 调用该 Setting 的 `edit(current)`，返回非 null 时触发 `change(newValue)`（= apply + persist）

#### Scenario: 显示写入作用域
- **WHEN** 渲染设置页面
- **THEN** SHALL 标注当前正在写入的作用域路径（项目级或全局级）

### Requirement: 命令收口到 Setting 抽象
系统 SHALL 让 `/model`、`/thinking` 命令底层通过对应 Setting 的 `change()`（`apply` + `persist`）执行，命令本身保留作快捷入口，消除"命令临时改 / 页面永久改"的双入口语义分裂。

#### Scenario: /model 走 Setting
- **WHEN** 用户执行 `/model`
- **THEN** SHALL 通过 `modelSetting.change()` 完成 apply + persist，不再仅调用 `session.cycleModel()` 而不持久化

#### Scenario: /thinking 走 Setting
- **WHEN** 用户执行 `/thinking`
- **THEN** SHALL 通过 `thinkingLevelSetting.change()` 完成 apply + persist

#### Scenario: 命令与页面行为一致
- **WHEN** 通过命令或 `/setting` 页面修改同一设置项
- **THEN** 生效与持久化行为 SHALL 完全一致（都走 apply + persist）

### Requirement: 通知配置项注册到 Setting 注册表
系统 SHALL 在 `src/settings/` 下为 `notifications` 配置块注册顶层设置项，纳入 `settings` 数组注册表，使 `/setting` 页面可枚举与编辑。

#### Scenario: 总开关 Setting
- **WHEN** 新增 `notifications.enabled` 设置项
- **THEN** SHALL 实现 `Setting<boolean>`，`key` 为 `"notifications.enabled"`，`label` 为 `"通知"`，`category` 归入 `"notifications"` 分组，`defaultValue` 为 `true`，`scope` 默认项目级

#### Scenario: 声音开关 Setting
- **WHEN** 新增 `notifications.sound` 设置项
- **THEN** SHALL 实现 `Setting<boolean>`，`key` 为 `"notifications.sound"`，`defaultValue` 为 `true`

#### Scenario: bash 阈值 Setting
- **WHEN** 新增 `notifications.bashThresholdSeconds` 设置项
- **THEN** SHALL 实现 `Setting<string>`（适配 input editor），`key` 为 `"notifications.bashThresholdSeconds"`，`defaultValue` 为 `"10"`（秒），`edit` 接受数字字符串输入，`apply`/`persist` 换算为毫秒

#### Scenario: 注册表枚举
- **WHEN** `/setting` 页面或命令枚举设置项
- **THEN** `settings` 数组 SHALL 包含上述三个 notifications 相关 Setting，按 `category: "notifications"` 分组渲染

#### Scenario: 细粒度开关不进页面
- **WHEN** 用户需调整 `events.*` 或 `channels.*` 细粒度开关
- **THEN** `/setting` 页面 SHALL NOT 暴露这些子项；用户 SHALL 通过直接编辑 config.json 修改（文档说明）

### Requirement: 通知配置走现有 apply + persist 模式
系统 SHALL 让 notifications 相关 Setting 通过现有 `apply(value, ctx)` + `persist(config, value)` 模式生效与持久化，与其他 Setting 行为一致，`apply` 通过全局 `NotificationRouter` 单例即时更新运行时配置。

#### Scenario: 修改总开关立即生效
- **WHEN** 用户在 `/setting` 页面将 `notifications.enabled` 从 `true` 改为 `false`
- **THEN** `apply` SHALL 通过 `getGlobalRouter().setEnabled(false)` 立即更新运行时 NotificationRouter，`persist` SHALL 写入 config.json，后续事件不再触发通知

#### Scenario: 持久化路径遵循 scope
- **WHEN** Setting 未声明 `scope`
- **THEN** `persist` SHALL 默认写入项目级 `.openagent/config.json`；声明 `scope: "global"` 时 SHALL 写入 `~/.config/openagent/config.json`

#### Scenario: persist 失败不回滚生效
- **WHEN** `writeConfig` 失败
- **THEN** SHALL NOT 回滚已执行的 `apply`，SHALL 向用户提示「已生效但未持久化」，不静默吞错（沿用现有 Setting 契约）

### Requirement: teams 配置块

系统 SHALL 在 `src/config.ts:Config` 接口新增可选字段 `teams`，类型为 `{enabled?, defaultWorkerModel?, maxWorkers?, defaultMaxTurns?, isolation?, cancelOrphansOnAgentEnd?, workerPermissions?}`。各字段均无填则按默认值生效，默认值 SHALL 在 `src/teams/types.ts` 集中定义一次。

#### Scenario: 默认配置生效
- **WHEN** `Config.teams` 为 `undefined` 或所有字段均为 `undefined`
- **THEN** 系统 SHALL 使用默认值：`enabled = true`、`defaultWorkerModel = undefined`（继承主 session model）、`maxWorkers = 4`、`defaultMaxTurns = 8`、`isolation = "none"`、`cancelOrphansOnAgentEnd = true`、`workerPermissions = { bashCommandAllowlist: [], networkRestricted: false }`

#### Scenario: 禁用整个 teams
- **WHEN** `Config.teams.enabled === false`
- **THEN** SHALL：
  - 不在 systemPrompt 中加载 team orchestrator 段
  - 从 `STANDARD_ACTIVE_TOOLS` 移除 `"team"` 工具（升级 active tools 列表时跳过该名）
  - `/team` / `/workers` slash 命令 SHALL 显示提示 `teams disabled in config`

#### Scenario: 自定义并发上限
- **WHEN** `Config.teams.maxWorkers` 配置为 `8`
- **THEN** `WorkerSessionPool.spawnWorker` SHALL 在 running worker 数达到 8 时拒绝新 spawn
- **AND** `team.spawn` 工具 SHALL 返回 `isError`，错误信息含 `"maxWorkers=8 reached"`

#### Scenario: 自定义默认 maxTurns
- **WHEN** `Config.teams.defaultMaxTurns` 配置为 `12`
- **THEN** 未在 frontmatter 声明 `maxTurns` 的 worker SHALL 使用 12 而非默认 8

#### Scenario: 自定义默认 worker model
- **WHEN** `Config.teams.defaultWorkerModel` 配置为 `"glm-5.1-air"`
- **AND** agent frontmatter 未声明 `model`
- **THEN** worker SHALL 使用 `resolveModel(modelRegistry, "glm-5.1-air")` 而非 parentModel
- **AND** resolveModel 返回 undefined 时 SHALL 回退到 parentModel 并 emit 一次性 warning 事件

#### Scenario: isolation 字段保留位（V1 不实现）
- **WHEN** `Config.teams.isolation` 配置为 `"worktree"`
- **THEN** V1 SHALL 视该字段为未实现，**等价于** `"none"`
- **AND** 进程启动时 SHALL 通过 stderr 输出一次性 warning `teams.isolation="worktree" not yet implemented, falling back to "none"`

#### Scenario: workerPermissions bash allowlist 透传
- **WHEN** `Config.teams.workerPermissions.bashCommandAllowlist` 配置为非空数组（如 `["ls", "cat", "git status"]`）
- **THEN** worker session 中 bash 工具 SHALL 仅允许执行匹配 allowlist 前缀的命令
- **AND** 不在 allowlist 的命令 SHALL 返回 isError `"bash command not in teams.workerPermissions.bashCommandAllowlist"`
- **AND** 空数组 SHALL 表示**禁用所有 bash 命令**（worker 默认无 bash）

#### Scenario: workerPermissions network 透传
- **WHEN** `Config.teams.workerPermissions.networkRestricted === true`
- **THEN** worker session SHALL NOT 注入 `webfetch` 工具到 active tools
- **AND** worker 即便 frontmatter tools 含 `webfetch` SHALL 被强制移除

### Requirement: teams 配置项注册到 Setting 注册表

系统 SHALL 在 `src/settings/` 下为 `teams` 配置块注册顶层 Setting 项，纳入 `settings` 数组注册表，使 `/setting` 页面可枚举与编辑核心字段（细粒度 `workerPermissions.bashCommandAllowlist[]` 不进页面，由用户直接编辑 config.json）。

#### Scenario: enabled Setting 注册
- **WHEN** 新增 `teams.enabled` 设置项
- **THEN** SHALL 实现 `Setting<boolean>`，`key: "teams.enabled"`、`label: "Teams 模式"`、`category: "teams"`、`defaultValue: true`、`scope` 默认项目级
- **AND** `apply(value, ctx)` SHALL 通过 `ctx.setConfig` 更新运行时 Config，下次主 agent 工具激活列表重算时生效，**不**对运行中的 worker 起作用
- **AND** `persist` SHALL 通过 `deepMerge` 写入项目级 `Config.teams`

#### Scenario: maxWorkers Setting 注册
- **WHEN** 新增 `teams.maxWorkers` 设置项
- **THEN** SHALL 实现 `Setting<string>`（适配 input editor 数字字符串输入），`key: "teams.maxWorkers"`、`label: "Teams 最大并发"`、`defaultValue: "4"`
- **AND** `edit` SHALL 接受 1–16 范围的数字字符串，超出范围 SHALL 提示 `"maxWorkers must be 1-16"`
- **AND** `apply` SHALL 把字符串换算为 number 写入 Config

#### Scenario: defaultMaxTurns Setting 注册
- **WHEN** 新增 `teams.defaultMaxTurns` 设置项
- **THEN** SHALL 实现 `Setting<string>`，`key: "teams.defaultMaxTurns"`、`defaultValue: "8"`
- **AND** `edit` SHALL 接受 1–50 范围的数字字符串

#### Scenario: 注册表枚举
- **WHEN** `/setting` 页面枚举设置项
- **THEN** `settings` 数组 SHALL 包含上述三个 teams 相关 Setting，按 `category: "teams"` 分组渲染
- **AND** 这些 Setting SHALL 与现有 `notifications.*` Setting 行为一致（apply + persist 即生效+写盘）

#### Scenario: 细粒度配置不进页面
- **WHEN** 用户需调整 `teams.defaultWorkerModel` / `isolation` / `cancelOrphansOnAgentEnd` / `workerPermissions.*`
- **THEN** `/setting` 页面 SHALL NOT 暴露这些子项
- **AND** 用户 SHALL 通过直接编辑 `~/.config/openagent/config.json` 或 `<cwd>/.openagent/config.json` 修改（文档说明）

