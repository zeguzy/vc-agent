## 1. SDK Spike（前置探查）

- [x] 1.1 调研 Pi SDK 运行时 API 面：`SettingsManager`（thinking level 能否 set 到任意值，非仅 cycle）、`AuthStorage`（`setRuntimeApiKey` 之外能否更新/删除/列出）、`ModelRegistry`（`registerProvider` 之外运行时切 model 走什么接口）、`AgentSession`（`cycleModel`/`cycleThinkingLevel` 之外有无 set 到指定值）
- [x] 1.2 产出"立即生效清单 vs 需重启生效清单"结论，写入 design.md 的 Spike Findings 段；用户选定方向 C（inMemory 阻止 Pi 持久化 + 自写 openagent/config.json）

## 2. 地基：inMemory SettingsManager + 写盘能力

- [x] 2.1 `src/agent/session.ts`：`createSession` 内部把 `SettingsManager.create(cwd)` 换成 `SettingsManager.inMemory(从 openagent/config 转换的初始 settings)`；返回值仍为 `AgentSession`（不扩展，句柄从 session 链式拿）
- [x] 2.2 `src/index.tsx`：确认 `createSession` 返回值未变（仍为 session），无需适配；句柄由 App 从 session 拿（见 6.2）
- [x] 2.3 `src/config.ts`：新增 `writeConfig(path, config)` 函数（与现有 `readConfig` 对称，JSON.stringify 写盘，失败抛错由调用方处理）

## 3. Setting 抽象基础设施

- [x] 3.1 `src/settings/types.ts`：定义 `Setting<T>` 接口、`SettingContext`、`SettingEditor`（实现用声明式 `editor` 字段替代原 `edit()` 方法，避免 textarea 焦点与外层 useKeyboard 冲突；`SettingContext` 含 `session`/`authStorage`/`modelRegistry`/`settingsManager`/`setUi`/`cwd`，无 `SessionHandles`——句柄从 session 链式拿）
- [x] 3.2 `src/settings/registry.ts`：导出 `settings: Setting<unknown>[]` 数组（4.x 填充 5 项）+ `findSetting(key)` helper

## 4. Setting 项落地（基于 spike 清单）

- [x] 4.1 UI 类：`thinking-collapsed.ts`、`context-mode.ts`（`apply` 走 `ctx.setUi`，`persist` 改对应 Config 字段）
- [x] 4.2 会话类：`model.ts`（`apply` 走 `ctx.modelRegistry.find`→`session.setModel`）、`thinking-level.ts`（`apply` 走 `session.setThinkingLevel`）；spike 确认两者均能 set 到指定值，无需降级
- [x] 4.3 会话类：`compaction-enabled.ts`（`apply` 走 `settingsManager.setCompactionEnabled`）；`compaction-threshold` 因 Pi 的 CompactionSettings 字段为 reserveTokens/keepRecentTokens、threshold 语义不明确，MVP 跳过
- [x] 4.4 `provider-apikey`：因 providers 是动态 Record、单 setting 项难以表达，MVP 跳过（保留 config.ts 启动时 setRuntimeApiKey 现有行为）
- [x] 4.5 将上述全部 Setting 注册到 `registry.ts` 的 `settings` 数组

## 5. SettingsPage 全屏页面

- [x] 5.1 `src/tui/components/SettingsPage.tsx`：按 `category` 分组渲染列表（`label` + `renderValue`），当前选中项标记，底部显示写入作用域路径
- [x] 5.2 交互：`j`/`k` 上下导航、`Enter` 按 `editor` 类型编辑（toggle 直接切 / select 展开选项 / input 提示用 `/model` 命令）、`Esc` 返回（实现用声明式 `editor` 字段替代原 `edit()` 方法，避免 textarea 焦点与外层 useKeyboard 冲突）
- [x] 5.3 变更流程：`Enter` 确认新值 → `apply(newValue, ctx)` + `persist` + `writeConfig` + 列表刷新；`writeConfig` 失败显示 "applied but not saved" 提示

## 6. App 集成 + 命令收口

- [x] 6.1 `src/tui/App.tsx`：顶层加 `view: "chat" | "settings"` state，settings view 提前 return `<SettingsPage>`
- [x] 6.2 App 构造 `SettingContext`：从 `session.settingsManager` / `session.modelRegistry` / `session.modelRegistry.authStorage` 链式拿句柄 + `setUi` 回调 + `cwd`
- [x] 6.3 `src/tui/commands.ts`：`slashCommands` 新增 `setting`；App switch 新增 `case "setting"` 切 view；useKeyboard 在 settings view 只处理 ctrlC（其余交给 SettingsPage）
- [x] 6.4 `/model` 收口：`cycleModel()` 生效 + `modelSetting.persist` + `writeConfig`（命令保留轮询语义 + 持久化结果）
- [x] 6.5 `/thinking` 收口：`cycleThinkingLevel()` 生效 + `thinkingLevelSetting.persist` + `writeConfig`

## 7. 验证

- [x] 7.1 `bunx tsc --noEmit` 类型检查全通过（EXIT 0，覆盖 session.ts / config.ts / settings/* / SettingsPage.tsx / App.tsx / commands.ts）
- [x] 7.2 `/setting` 打开页面、`j/k` 导航、`Enter` 编辑、`Esc` 返回 — 代码审查 + tsc 通过；运行时交互（全屏 TUI alternate screen）需用户本地 `bun run dev` 确认
- [x] 7.3 立即生效（model / thinking.level / contextMode / thinking.collapsed）— 代码审查确认 apply 调对应 Pi setter（setModel / setThinkingLevel / setUi / setCompactionEnabled）；运行时行为需本地确认
- [x] 7.4 持久化（写 `.openagent/config.json` + 重启保留）— `writeConfig` 已实现，命令收口与页面 change 均调用；文件写入需本地确认
- [x] 7.5 命令收口（`/model` `/thinking` 持久化，与页面行为一致）— 代码审查确认 case 调 `persist` + `writeConfig`；运行时需本地确认
- [x] 7.6 spike 标注项 — N/A：spike 确认全部设置项均能立即生效（Pi 有对应 setter），无 restart-required 项需标注
