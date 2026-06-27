## MODIFIED Requirements

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
