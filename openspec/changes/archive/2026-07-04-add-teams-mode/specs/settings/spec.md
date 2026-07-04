## ADDED Requirements

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