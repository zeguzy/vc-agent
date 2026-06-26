## Why

当前配置系统（`add-config-system`）是**只读**的：启动时一次性 merge 全局/项目 config.json，无运行时修改、无持久化、无 UI 入口。更根本的问题是设置项的"属性"和"维护能力"被切散在多处——schema 在 `config.ts`、默认值在 `App.tsx` 的 `useState` 初值、修改入口在 keymap 或命令 switch、持久化完全缺失。典型如 `thinking.collapsed`：定义、初值、修改散落 4 个文件，改完重启就丢，且与 `thinking.level`（SDK 级）命令撞名。

需要把设置项抽象为**自包含单元**（属性 + 生效 + 持久化 co-locate），通过 `/setting` 页面让用户在 TUI 内配置，并**尽量立即生效 + 立即写盘**。

## What Changes

- **新增 `Setting<T>` 抽象**：一个设置项 = 一个自带能力的记录（`key`/`label`/`category`/`scope`/`defaultValue`/`read`/`apply`/`persist`/`renderValue`/`edit`），属性与维护逻辑在同一处。
- **每设置项一文件 + registry**：`src/settings/<key>.ts` 自包含，`registry.ts` 汇总成数组；加一项 = 加一文件，零改动他处。
- **`createSession` 改用 `SettingsManager.inMemory()`**：阻止 Pi 写自己的 settings.json（避免双写漂移），启动时从 openagent/config.json 转换灌入初始 settings。SDK 句柄（`settingsManager`/`modelRegistry`/`authStorage`）从 `session` 链式访问（spike 确认已公开，**不扩展返回值**），供会话能力类设置项 apply 调用立即生效。
- **新增 `/setting` 命令 + 全屏设置页面**：`j/k` 导航、`Enter` 编辑、改完立即 apply（调 Pi setter，inMemory 下仅改内存）+ persist（写 openagent/config.json）、`Esc` 回 chat。App 顶层加 `view: "chat" | "settings"` 状态切换。
- **收口 `/model` `/thinking` 命令**：底层改走对应 Setting 的 `apply+persist`，命令本身保留作快捷入口（消除双入口语义分裂）。

## Capabilities

### New Capabilities
- `settings`: 设置项自包含抽象（Setting 接口、registry）、`/setting` 全屏页面交互、立即生效（apply 调 Pi setter）+ 立即写盘（persist 写 openagent/config.json，项目级默认可声明全局）、apply/persist 双轨。

### Modified Capabilities
- `agent-session`: `createSession` 内部把 `SettingsManager.create(cwd)` 换成 `SettingsManager.inMemory(从 openagent/config 转换的初始 settings)`，阻止 Pi 写 settings.json；SDK 句柄通过 `session.settingsManager`/`session.modelRegistry`/`session.modelRegistry.authStorage` 链式访问。
- `tui-input`: `/model` `/thinking` 命令底层改走 Setting 抽象（apply+persist）；新增 `/setting` 命令打开设置页面。

## Non-goals

- 不实现设置项导入/导出（`config get/set` CLI 子命令）。
- 不做设置页面搜索/过滤（MVP 项数少，`j/k` 足够）。
- 不做设置变更历史/撤销/回滚 UI。
- 不监听 config 文件外部修改的热重载。
- 不实现 `/setting <key> <value>` 命令行式直设（MVP 只做交互页面）。
- 不重写现有 `Config` interface（复用，仅新增 `writeConfig`）。
- 不处理设置页面内嵌套分组/折叠（MVP 扁平 `category` 分组）。
- 不复用 Pi 的 settings.json 持久化（选定方向 C：inMemory 阻止 Pi 写盘，自写 openagent/config.json）。

## Impact

- **新增文件**:
  - `src/settings/types.ts` — `Setting<T>` / `SettingContext` 接口
  - `src/settings/registry.ts` — 设置项注册表
  - `src/settings/<key>.ts` × N — 各设置项自包含文件（model / thinking-level / thinking-collapsed / context-mode / compaction-enabled / provider-apikey，spike 已确认全部能立即生效）
  - `src/tui/components/SettingsPage.tsx` — 全屏设置页面
- **修改文件**:
  - `src/agent/session.ts` — `createSession` 内部 `SettingsManager.create` → `inMemory`（从 openagent/config 转换灌入），返回值不变
  - `src/tui/App.tsx` — 顶层 `view` 状态、从 `session` 链式拿句柄构造 `SettingContext`、收口 `/model` `/thinking`、调 `writeConfig`
  - `src/config.ts` — 新增 `writeConfig(path, config)`（当前只有 read）
- **不修改**: `src/index.tsx`（createSession 返回值未变，无需适配）
- **依赖/系统**: 无新增依赖；纯架构重构 + 新 UI，无 API/数据模型破坏性变更。
- **spike 结论（已完成）**: Pi SDK API 面完整，所有设置项均能立即生效（`session.setModel`/`setThinkingLevel`、`settingsManager.setHideThinkingBlock`/`setCompactionEnabled`、`authStorage.setRuntimeApiKey`），原"边界 #3"风险消除。选定方向 C 接受失去 Pi 的 scope/锁/错误处理，由 `writeConfig` 自行实现简单同步写。
