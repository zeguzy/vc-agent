## ADDED Requirements

### Requirement: /config init 命令生成配置文件模板

系统 SHALL 提供 `/config init [project|global] [--force]` slash command,基于全字段默认值模板在指定作用域生成配置文件,作为 `/config` 命令组的第一个子命令。

#### Scenario: 缺省生成项目级配置

- **WHEN** 用户执行 `/config init`(无参数)
- **THEN** 系统 SHALL 在 `<cwd>/.openagent/config.json` 生成包含所有有默认值的 `Config` 字段的完整 JSON 配置文件
- **AND** SHALL 通过 assistant 消息反馈生成成功与文件绝对路径

#### Scenario: 显式指定项目级

- **WHEN** 用户执行 `/config init project`
- **THEN** 系统 SHALL 在 `<cwd>/.openagent/config.json` 生成配置文件
- **AND** SHALL 反馈生成成功与路径

#### Scenario: 指定全局级

- **WHEN** 用户执行 `/config init global`
- **THEN** 系统 SHALL 在 `~/.config/openagent/config.json` 生成配置文件
- **AND** SHALL 反馈生成成功与路径

#### Scenario: scope 参数大小写不敏感

- **WHEN** 用户执行 `/config init Global` 或 `/config INIT Project`
- **THEN** 系统 SHALL 大小写不敏感地识别 scope 参数,按对应作用域生成文件

### Requirement: 目标文件存在时的覆盖保护

系统 SHALL 在目标配置文件已存在时默认拒绝覆盖,仅在显式传入 `--force` flag 时才覆盖,防止误操作丢失用户自定义配置。

#### Scenario: 文件已存在且未加 --force

- **WHEN** 目标配置文件已存在
- **AND** 用户执行 `/config init <scope>`(无 `--force`)
- **THEN** 系统 SHALL NOT 修改该文件
- **AND** SHALL 通过 assistant 消息报错,明确提示文件已存在、给出该文件绝对路径
- **AND** SHALL 在消息中建议使用 `--force` flag 覆盖

#### Scenario: 文件已存在且加 --force

- **WHEN** 目标配置文件已存在
- **AND** 用户执行 `/config init <scope> --force`
- **THEN** 系统 SHALL 用新模板覆盖该文件
- **AND** SHALL 通过 assistant 消息明确反馈"已覆盖原文件"与路径

#### Scenario: --force 覆盖全局配置时额外提醒

- **WHEN** `scope` 为 `global`
- **AND** 目标文件已存在
- **AND** 用户加 `--force` 执行覆盖
- **THEN** 系统 SHALL 在反馈消息中额外提醒"全局配置已被覆盖,建议用 git 或备份恢复"(因全局配置可能含用户精心调优的 providers/API keys)

#### Scenario: --force 位置无关

- **WHEN** 用户执行 `/config init --force global` 或 `/config init global --force`
- **THEN** 系统 SHALL 正确解析 `--force` flag 与 scope 参数,与固定位置等价

### Requirement: 配置模板字段策略与默认值单一真相源

系统 SHALL 在 `src/config.ts` 导出纯函数 `getDefaultConfigTemplate(): Config`,返回包含 `Config` 接口所有有默认值字段的合理默认对象,作为模板与运行时默认的单一真相源。无有意义默认值的字段(`model`)SHALL 省略;默认关闭且结构极复杂的字段(`contextPruning`)SHALL 只放最小合法默认。

#### Scenario: 模板覆盖所有有默认值的顶层字段

- **WHEN** 调用 `getDefaultConfigTemplate()`
- **THEN** 返回对象 SHALL 包含所有有默认值的顶层字段:`thinking`、`providers`、`display`、`compaction`、`skills`、`notifications`、`teams`、`contextPruning`、`instructions`
- **AND** `model` key SHALL 不存在(无有意义默认值,取决于用户 provider,由用户按需添加)
- **AND** 每个字段的值类型 SHALL 与 `Config` 接口定义兼容

#### Scenario: model 字段省略不破坏模板合法性

- **WHEN** `getDefaultConfigTemplate()` 返回的对象不含 `model` key
- **THEN** 该对象 SHALL 仍是合法 `Config`(`model` 是 optional)
- **AND** 经 `JSON.stringify` 后的 JSON 字符串 SHALL 是合法 JSON,可被 `readConfig` 的 `JSON.parse` 回读

#### Scenario: contextPruning 放最小合法默认

- **WHEN** 模板包含 `contextPruning` 字段
- **THEN** 其值 SHALL 深度等于 `{ enabled: false }`(DCP 默认 opt-out)
- **AND** SHALL NOT 直接引用 `DEFAULT_CONTEXT_PRUNING`(因其类型 `ContextPruningConfig` 是 resolved 版本,与 `Config.contextPruning: ContextPruningUserConfig` 类型不兼容)
- **AND** 用户启用 DCP 后可自行参考 `DEFAULT_CONTEXT_PRUNING` 展开细节

#### Scenario: 模板可被 readConfig 回读且 resolve 不抛异常

- **WHEN** 将 `getDefaultConfigTemplate()` 的返回值经 `writeConfig` 写盘
- **AND** 用 `readConfig` 读回该文件
- **THEN** 读回的配置 SHALL 是合法 `Config` 对象,无 JSON 解析错误
- **AND** `resolveTeamConfig(result.teams)` SHALL 不抛异常
- **AND** `resolveNotificationsConfig(result.notifications)` SHALL 不抛异常

#### Scenario: teams 默认值引用模块常量

- **WHEN** 模板包含 `teams` 字段
- **THEN** 其默认值 SHALL 引用 `src/teams/types.ts` 导出的 `DEFAULT_TEAM_CONFIG`(展开或直接引用),而非在模板里重复硬编码字段值

#### Scenario: notifications 默认值引用模块函数

- **WHEN** 模板包含 `notifications` 字段
- **THEN** 其默认值 SHALL 引用 `src/notifications/config.ts` 导出的 `getDefaultNotificationsConfig()` 返回值,而非在模板里重复硬编码字段值

### Requirement: 命令注册到 built-in registry 并出现在 /help

系统 SHALL 在 `src/tui/commands.ts` 的 `registerBuiltinCommands()` 中注册 `/config` 命令,使其被 `/help` 自动枚举。

#### Scenario: 命令注册

- **WHEN** `registerBuiltinCommands()` 执行
- **THEN** `commandRegistry` SHALL 包含名为 `config` 的命令
- **AND** 该命令的 `description` SHALL 简洁描述"生成配置文件模板"

#### Scenario: /help 自动包含

- **WHEN** 用户执行 `/help`
- **THEN** 输出 SHALL 包含 `config` 命令条目(由 `buildHelpText()` 自动生成)

### Requirement: 未识别参数给出清晰错误反馈

系统 SHALL 在 `/config init` 收到无法识别的 scope 值或非 `init` 子命令时,通过 assistant 消息给出清晰错误提示与用法说明,不产生副作用(不创建/修改文件)。

#### Scenario: 未识别的 scope 值

- **WHEN** 用户执行 `/config init user`(`user` 非 `project`/`global`)
- **THEN** 系统 SHALL NOT 创建或修改任何文件
- **AND** SHALL 通过 assistant 消息反馈错误,列出合法 scope 值(`project`、`global`)
- **AND** SHALL 给出 `/config init [project|global] [--force]` 用法提示

#### Scenario: 缺少 init 子命令

- **WHEN** 用户执行 `/config`(无子命令)
- **OR** 用户执行 `/config foo`(非 `init` 子命令)
- **THEN** 系统 SHALL 通过 assistant 消息反馈当前仅支持 `init` 子命令
- **AND** SHALL 给出 `/config init [project|global] [--force]` 用法提示
- **AND** SHALL NOT 产生任何文件副作用

### Requirement: 写入失败时反馈错误不中断 session

系统 SHALL 在 `writeConfig` 抛出系统错误(如 `EACCES` 权限、`ENOENT` 路径异常)时,通过 handler 的 try-catch 捕获,格式化错误并反馈,不中断当前 session。

#### Scenario: writeConfig 抛系统错误

- **WHEN** `writeConfig` 因 `EACCES`、`ENOENT` 或其他系统错误抛异常
- **THEN** handler SHALL 捕获异常(不冒泡到全局)
- **AND** SHALL 通过 `formatError` 格式化错误信息
- **AND** SHALL 通过 `createAssistantMessage` 反馈"写入失败"与错误详情
- **AND** SHALL NOT 中断当前 session 或导致 TUI 崩溃
