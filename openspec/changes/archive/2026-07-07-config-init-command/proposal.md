## Why

目前用户要配置 openagent(项目级或全局级),必须手动查文档、手写 JSON、猜测字段名与默认值。缺少一个"一键生成模板"的入口,导致上手成本高、字段易拼错、JSON 格式易出错。提供一个 `/config init` 命令可以显著降低配置上手门槛,并保证生成的文件结构合法、字段齐全。

## What Changes

- 新增 `/config init [project|global] [--force]` slash command,作为 `/config` 命令组的第一个子命令
- 缺省(无参数或 `project`)生成**项目级**配置:`<cwd>/.openagent/config.json`
- 传 `global` 生成**全局级**配置:`~/.config/openagent/config.json`
- 生成的配置文件是**包含所有可用字段 + 合理默认值的完整 JSON 模板**,用户改值即可
- 目标文件已存在时**默认报错**并打印路径,加 `--force` 才覆盖
- 复用现有 `writeConfig(cwd, config, scope)` 基础设施,不引入新依赖,不改动 `readConfig`/`deepMerge`

## Non-goals

- **不实现** `/config edit`、`/config show`、`/config path` 等其他子命令 —— MVP 只做 `init`,命令结构(`/config <sub>`)为未来扩展预留入口,但本轮不实现其他子命令的行为
- **不修改** 现有 `readConfig` / `writeConfig` / `deepMerge` 的语义或签名
- **不做** 交互式问答生成(wizard 式逐项询问) —— 只输出静态完整模板
- **不在模板里加注释** —— JSON 标准不支持注释,`readConfig` 也不解析 JSONC;模板用「全字段默认值」让用户一目了然,字段含义依赖文档
- **不修改** `/setting` 页面、`Setting<T>` 抽象或 `settings` 注册表 —— 本命令是"从零生成文件",与"修改已存在配置项"的 Setting 抽象正交
- **不引入** 配置 schema 校验/迁移逻辑

## Capabilities

### New Capabilities

- `config-init-command`: `/config init [project|global] [--force]` slash command,基于全字段默认值模板生成项目级或全局级配置文件,支持 `--force` 覆盖已存在文件

### Modified Capabilities

(无 —— 这是纯新增功能,不改任何现有 spec 的 requirements。`settings` spec 关注的是 `/setting` 页面修改已存在配置项,与本命令"从零生成模板文件"正交,无 spec 级别交集。)

## Impact

- **新增代码**:
  - `src/config.ts`:新增 `getDefaultConfigTemplate()` 纯函数,返回包含所有字段默认值的 `Config` 对象(单一真相源,未来字段扩展只改一处)
  - `src/tui/commands.ts`:在 `registerBuiltinCommands()` 内注册 `/config` 命令,解析 `[project|global]` 子命令与 `--force` flag
- **复用**:`writeConfig(cwd, config, scope)`(已自动建目录、2 空格缩进、尾换行);`createAssistantMessage` 反馈 helper;`formatError` 错误格式化
- **新增测试**:`tests/config-template.test.ts` 验证模板结构(字段齐全、可被 `readConfig` 回读、JSON 合法)
- **无依赖变更、无 API 变更、无破坏性变更**
- `/help` 自动包含新命令(由 `buildHelpText()` 从 registry 生成,无需手动维护)
