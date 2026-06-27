## Context

当前 `src/config.ts` 名义是"配置模块"，实为**只读 schema + 启动时一次性 deepMerge**。设置项的属性与维护能力被切散：

```
setting: thinking.collapsed  (现状足迹)
─────────────────────────────────────────────────
属性定义    config.ts:22        ThinkingConfig.collapsed
默认值      App.tsx:34          useState(config?... ?? false)
修改入口    keymap.ts           NORMAL 模式 t 键 → toggleThinking
持久化      ❌ 缺失              改完重启丢失
渲染        MessageList         读 prop

setting: model  (现状足迹)
─────────────────────────────────────────────────
属性定义    config.ts:35        Config.model
CLI 覆盖    index.tsx:59        args.model ?? config.model
修改入口    App.tsx switch      /model 命令 → session.cycleModel()
持久化      ❌ 缺失              cycleModel 不写 config
```

两类问题：(1) **无持久化**——`/model` `/thinking` 改的是 session/内存状态，重启回退；(2) **属性与维护分离**——加/改一个设置项要动 4+ 文件，且命令与配置文件语义脱节。

## Goals / Non-Goals

**Goals:**
- 设置项成为**自包含单元**：属性（key/label/default/scope）+ 维护能力（read/apply/persist/render/edit）在同一处。
- `/setting` 全屏页面让用户在 TUI 内配置，**改即生效 + 改即写盘**。
- 会话能力类设置项（model/providers/thinking level）支持**立即生效**。
- 收口 `/model` `/thinking` 命令到同一抽象，消除双入口语义分裂。

**Non-Goals:**
- 设置项导入/导出、搜索过滤、变更历史、热重载、命令行式直设（见 proposal Non-goals）。
- 不统一所有运行时状态（消息列表、滚动位置等非"配置"状态不纳入）。

## Decisions

### 决策 1：`Setting<T>` 自包含抽象，属性与行为 co-locate
**选择**：一个设置项是一个对象，自带元数据 + read/apply/persist/render/edit 方法。
```ts
interface Setting<T> {
  key: string; label: string; category: "ui" | "session"
  scope?: "global"                // 默认 project
  defaultValue: T
  read(config: Config): T
  renderValue(v: T): string
  edit(current: T): Promise<T | null>   // 页面 Enter 调出编辑器
  apply(value: T, ctx: SettingContext): void
  persist(config: Config, value: T): Config   // 不可变更新
}
```
**理由**：直击"属性和维护一块儿"诉求。`apply` 因项而异（UI 项 setState、会话项调 SDK），每项自己实现 = 真正 co-location。
**备选**：纯 schema 数组（只有元数据）+ 集中 dispatcher —— 否决，dispatcher 会重新聚拢逻辑，回到分散。**备选**：每项独立 React hook —— 否决，UI 与逻辑耦合，页面难以统一渲染。

### 决策 2：每设置项一文件 + registry 数组
**选择**：`src/settings/<key>.ts` 每项一文件，`registry.ts` 导出 `settings: Setting[]`。`/setting` 页面 `settings.map(render)`。
**理由**：加一项 = 加一文件，零改动他处；删一项 = 删一文件 + 移除 registry 一行。这是"维护一块儿"的 payoff。
**备选**：单文件 all-in-one —— 否决，文件膨胀且混在一起。

### 决策 3：扩展 `createSession` 返回值，解禁 SDK 句柄（地基）
**选择**：`createSession()` 返回 `{ session, authStorage, modelRegistry, settingsManager }`。
```ts
// 现在
export async function createSession(o): Promise<AgentSession>
// 改为
export interface SessionHandles {
  session: AgentSession
  authStorage: AuthStorage
  modelRegistry: ModelRegistry
  settingsManager: SettingsManager
}
export async function createSession(o): Promise<SessionHandles>
```
**理由**：会话能力类设置项的 `apply()` 必须能调 `authStorage.setRuntimeApiKey()` / `modelRegistry.registerProvider()` / `settingsManager.set*()`。当前这些句柄锁在闭包里，外部拿不到——不解禁，"立即生效"对 providers 类是空话。
**备选**：在 session 上挂句柄（`session._handles`）—— 否决，污染 SDK 类型，且 session 是 SDK 提供的。**备选**：只解禁部分句柄 —— 否决，registry 驱动需要统一 ctx。

### 决策 4：apply / persist 双轨分离
**选择**：每次值变更做两件事，正交解耦：`apply(value, ctx)` 立即生效（改运行时），`persist(config, value)` 返回新 Config 由调用方写盘。
```
change(value)
  ├─ apply(value, ctx)        // 生效：setState 或调 SDK
  └─ persist(config, value)   // 新 Config
       └─ writeConfig(path, newConfig)  // 调用方写盘
```
**理由**：生效与持久化语义独立（用户可能想临时改不存盘，未来扩展）；失败处理可分别对待（apply 成功 + persist 失败 ≠ 全失败）。
**备选**：单一 `set(value)` 内部既生效又写盘 —— 否决，无法应对临时改/永久改的区分，且测试困难。

### 决策 5：全屏 view 切换（非模态/分屏）
**选择**：App 顶层 `useState<"chat"|"settings">("chat")`，`/setting` 切到 settings view 整屏渲染 `SettingsPage`，`Esc` 回 chat。
**理由**：TUI 里模态需 overlay 原语（OpenTUI 未必支持）+ 焦点透传复杂；分屏在窄终端挤。全屏切换就是条件渲染，OpenTUI 必然支持，零原生依赖。
**备选**：模态浮层 —— 否决，OpenTUI overlay 能力未知且交互复杂。**备选**：侧边面板 —— 否决，列宽紧张。

### 决策 6：命令收口 —— `/model` `/thinking` 走 Setting 抽象
**选择**：命令保留作快捷入口，但 case 内部调 `modelSetting.change(value)`（= apply + persist），不再直接 `session.cycleModel()`。
**理由**：消除"命令临时改、页面永久改"的双入口分裂；命令与页面行为一致，符合"唯一真相"。
**备选**：删命令全走页面 —— 否决，砍掉肌肉记忆快捷入口。**备选**：命令保持临时语义 —— 否决，语义分裂违反收口初衷。
**注**：`/model` 现在是 `cycleModel()`（轮询下一个），收口后需决定"命令轮询 vs 页面选择"——design 倾向命令保持轮询便捷、但轮询结果同样走 persist 写盘。

### 决策 7：项目级默认作用域，Setting 可声明 `scope: "global"`
**选择**：`writeConfig` 默认写 `.openagent/config.json`（项目级）；Setting 声明 `scope: "global"` 则写 `~/.config/openagent/config.json`。
**理由**：在项目里开 `/setting` 语义是"配这个项目"；纯个人偏好（未来 theme）可声明全局。作用域成为设置项**属性之一**，仍 co-locate。
**备选**：页面让用户每次选作用域 —— 否决，增加每次决策负担（MVP 简洁）。**备选**：全写全局 —— 否决，丢失项目级配置能力。

## 架构与数据流

```
┌─ src/ ──────────────────────────────────────────────────────┐
│                                                              │
│  agent/session.ts                                            │
│    createSession() → SessionHandles ──┐                      │
│                                       │                      │
│  config.ts                            │                      │
│    readConfig / writeConfig ◀──────── │ ── 写盘             │
│                                       │                      │
│  settings/                            ▼                      │
│    types.ts        Setting<T>, SettingContext                │
│    registry.ts     settings: Setting[]                       │
│    model.ts ──┐                                              │
│    thinking-level.ts ─┤  每项自包含:                          │
│    thinking-collapsed.ts ┤  read/apply/persist/render/edit   │
│    context-mode.ts ─┤   apply 用 ctx.{session,句柄,setUi}    │
│    compaction.ts ─┤                                          │
│    provider-apikey.ts ┘                                      │
│                                                              │
│  tui/                                                        │
│    App.tsx         view: "chat"|"settings" + 收口命令        │
│    components/                                               │
│      SettingsPage.tsx  settings.map(render) + j/k/Enter      │
│      InputBox / MessageList / StatusBar (chat view)          │
└──────────────────────────────────────────────────────────────┘


一次设置变更的旅程（用户在 /setting 把 Model 改为 X）
═══════════════════════════════════════════════════════
  SettingsPage: Enter → modelSetting.edit(current) → X
     │
     ▼ modelSetting.change(X)
     ├──▶ apply(X, ctx)
     │      └─ ctx.session 切到 X          // 立即生效
     │         UI 反映新 model
     └──▶ persist(config, X) → newConfig   // 不可变
            └─ writeConfig(projectPath, newConfig)  // 立即写盘
               ├─ ok → done
               └─ fail → 提示"生效未持久化"(见风险#1)
```

## Risks / Trade-offs

- **[风险#1] apply 成功但 persist 写盘失败**（磁盘满/权限）→ **缓解**：不回滚 apply（生效是用户意图），页面 toast 提示"已生效但未保存到 <path>"，不静默吞错。
- **[风险#2] 对话运行中改 model/provider** → **缓解**：`apply` 切换是"下次 prompt 生效"，不打断进行中的对话（与现有 `/model` 行为一致）；页面在 `isRunning` 时仍允许改，但提示"下条消息起生效"。
- **[风险#3] SDK API 面不完整，部分设置项无法立即生效** ⚠ **最关键** → `SettingsManager`（thinking level 有 `setDefaultThinkingLevel`，但是否有 set 到任意值？）、`AuthStorage`（有 `setRuntimeApiKey`，但删除/更新 provider？）、`ModelRegistry`（`registerProvider` 有，运行时切 model 走 `session` 还是 registry？）。**缓解**：tasks 第一项是 **SDK spike**，逐项核对这些 API，产出"能立即生效清单 vs 需重启生效清单"；proposal 不承诺 100% 立即生效，只承诺"尽量"。无法立即生效的项在页面标注"重启生效"。
- **[取舍] 项目级默认可能不符用户"全局偏好"预期** → 通过 `scope: "global"` 声明覆盖（决策 7），MVP 只在必要时声明。
- **[取舍] 命令收口后 `/model` 轮询语义需重新定义** → 轮询仍便捷，但轮询结果要 persist；若轮询穿过"未配置的 model"需处理 fallback。

## Migration Plan

无破坏性 API/数据模型变更，纯架构演进，可渐进：
1. 先加 `settings/` 模块 + `createSession` 扩展（不影响现有行为，返回值多几个字段，调用方解构即可）。
2. `writeConfig` 新增（独立函数，不影响 read）。
3. `/setting` 页面 + 各 Setting 项逐个落地（每项独立，可分批）。
4. 命令收口最后做（`/model` `/thinking` 切到 Setting 调用，行为对外不变只加持久化）。
5. 回滚：任何阶段中断，已落地部分独立可用，不影响 chat 基础功能。

## Spike Findings（任务 1.2 产出）

调研 Pi SDK 的 `dist/core/*.d.ts` + `settings-manager.js` 实现，结论如下：

### API 面（比预期完整得多）
- **AgentSession**: 有 `setModel(model)` / `setThinkingLevel(level)`（**set 到指定值**，非仅 cycle）+ `cycleModel` / `cycleThinkingLevel` + `setAutoCompactionEnabled` + `setSteeringMode` 等。
- **SettingsManager**: 海量 `setXxx`（`setDefaultThinkingLevel` / `setDefaultModel` / `setCompactionEnabled` / `setHideThinkingBlock` / `setTheme` ...），全部 set 到指定值。
- **AuthStorage**: `set(provider, cred)`（持久化 auth.json）/ `setRuntimeApiKey`（不持久化）/ `remove` / `list` / `login` / `logout`。
- **ModelRegistry**: `registerProvider` / `unregisterProvider` / `getAll` / `find` / `refresh`。
- **句柄可达性**: `session.settingsManager`（readonly）、`session.modelRegistry`（getter）、`session.modelRegistry.authStorage`（readonly）**全部公开**——不需要扩展 `createSession` 返回值（原决策 3 可降级/取消）。

### ⚠ 重大发现：Pi setter 自带持久化
`settings-manager.js` 中 `setDefaultThinkingLevel` 实现：`this.globalSettings.defaultThinkingLevel = level; this.markModified(...); this.save();`。**每个 setter 一次调用 = 立即生效 + 写 settings.json（带 global/project scope + 文件锁）**。

### 立即生效清单（spike 结论：几乎全能）
| 设置项 | 立即生效接口 | 持久化 |
|---|---|---|
| model | `session.setModel(model)` | session 内部存 |
| thinking.level | `session.setThinkingLevel(level)` | settingsManager.save |
| thinking.collapsed | `settingsManager.setHideThinkingBlock(bool)` | save（注：Pi 字段名 hideThinkingBlock） |
| compaction.enabled | `session.setAutoCompactionEnabled(bool)` / `settingsManager.setCompactionEnabled` | save |
| providers.*.apiKey | `authStorage.set(provider, cred)` | auth.json |
| display.contextMode | 无 Pi 对应（vc-agent 纯 UI 状态） | 仅 openagent/config |

### 架构冲突（需用户决策）
Pi setter 写 **Pi 的 settings.json**（`~/.pi/agent/settings.json` + `.pi/settings.json`）。vc-agent 现有 `config.ts` 读 **openagent/config.json**。若 Setting.apply 调 Pi setter（立即生效），就**必然触发 Pi 写 settings.json**；再自己 `writeConfig` 写 openagent/config.json 就是**双写双轨**。

**候选方向（待用户拍板）：**
- **A（推荐）**: 持久化复用 Pi `SettingsManager`（apply = 调 setter，一次完成生效+持久化）；openagent/config.json 降级为"启动兼容读取/迁移源"，不再作运行时持久化目标。Setting 抽象简化（apply/persist 合一）；取消 `writeConfig` 任务与决策 4/7。
- **B**: 保持 openagent/config.json 为 source of truth，apply 调 Pi setter（接受 Pi 也写 settings.json 的双写副作用），persist 额外写 openagent/config.json。双轨。
- **C**: apply 调 Pi setter 生效，但用 `SettingsManager.inMemory()` 阻止 Pi 持久化，自己写 openagent/config.json。违背 Pi 设计 + 失去 Pi 持久化能力。

**推荐 A 的理由**: 零重复（复用 Pi 成熟的 scope/锁/错误处理）、Setting 抽象更简单（apply 即一切）、避免双写漂移。代价：openagent/config.json 不再是运行时配置源，需处理存量用户迁移。

### 最终决策（用户选定 C）

用户选定方向 **C**：apply 调 Pi setter 立即生效，但 `createSession` 改用 `SettingsManager.inMemory()` 阻止 Pi 写 settings.json，持久化由 Setting.persist 自己写 openagent/config.json。

**对原决策的影响（修订）：**
- **决策 3 取消**：spike 证实 `session.settingsManager` / `session.modelRegistry` / `session.modelRegistry.authStorage` 全部公开可访问。**不扩展 `createSession` 返回值**，App 直接从 session 链式拿句柄。
- **决策 3 替换为新决策 3′**：`createSession` 内部把 `SettingsManager.create(cwd)` 换成 `SettingsManager.inMemory(从 openagent/config 转换的初始 settings)`。启动时读 openagent/config.json → 转成 `Partial<Settings>` 灌入 inMemory，Pi 不读写 settings.json。
- **决策 4 保留**：apply（调 Pi setter，inMemory 下仅改内存生效）+ persist（自己 writeConfig 写 openagent/config.json）双轨。
- **决策 7 保留**：项目级 openagent/config.json 默认，`scope: "global"` 写全局。
- **`writeConfig` 任务保留**。

**C 下各设置项的 apply/persist 映射：**

| 设置项 | apply（调 Pi，inMemory 不写盘） | persist（写 openagent/config） |
|---|---|---|
| model | `session.setModel(model)` | `config.model` |
| thinking.level | `session.setThinkingLevel(level)` | `config.thinking.level` |
| thinking.collapsed | `settingsManager.setHideThinkingBlock(bool)` | `config.thinking.collapsed` |
| compaction.enabled | `settingsManager.setCompactionEnabled(bool)` | `config.compaction.enabled` |
| display.contextMode | `ctx.setUi.setContextDisplay()`（纯 UI，无 Pi 接口） | `config.display.contextMode` |
| providers.*.apiKey | `authStorage.setRuntimeApiKey(provider, key)`（runtime override，不碰 auth.json） | `config.providers.*.apiKey` |

**C 的取舍（用户已知悉并接受）**：失去 Pi 自带的 scope 分级写入/文件锁/错误处理，由 `writeConfig` 自行实现简单的同步写 + 错误提示（持久化失败不回滚 apply，见风险 #1）。换取：品牌一致（配置仍是 openagent/config.json）+ 单写（无双写漂移）+ Pi 完全无状态持久化（迁移干净）。
