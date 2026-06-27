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

