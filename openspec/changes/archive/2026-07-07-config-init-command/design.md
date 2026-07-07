## Context

openagent 的配置体系现状:

- **两级配置**:`readConfig(cwd)` 读取全局(`~/.config/openagent/config.json`)+ 项目(`<cwd>/.openagent/config.json`),通过 `deepMerge(global, project)` 合并(project 覆盖 global)。
- **写入基础设施**:`writeConfig(cwd, config, scope)` 已存在,自动 `mkdirSync(recursive)`、`JSON.stringify(config, null, 2)` + 尾换行,支持 `"project"`/`"global"` 双作用域。
- **Config 接口**(`src/config.ts:49`):10 个可选顶层字段 —— `model`、`thinking`、`providers`、`display`、`compaction`、`skills`、`notifications`、`teams`、`contextPruning`、`instructions`。
- **嵌套默认值已有单一真相源**:
  - `DEFAULT_TEAM_CONFIG`(`src/teams/types.ts:39`):9 个字段(enabled/maxWorkers/defaultMaxTurns/isolation/cancelOrphans*2/maxIdleMembers/messageHistoryLimit/messageRateLimitPerMinute)。
  - `getDefaultNotificationsConfig()`(`src/notifications/config.ts:16`):返回完整默认对象,含 events/channels 细粒度开关。
- **命令系统**:`commandRegistry.register()` 单例注册,所有 built-in 命令在 `src/tui/commands.ts:registerBuiltinCommands()` 集中注册;`/help` 由 `buildHelpText()` 自动从 registry 生成。

**问题**:用户要从零创建一份配置文件,必须翻文档猜字段名、手写 JSON,易拼错、易格式错。缺少"一键生成合法模板"的入口。

## Goals / Non-Goals

**Goals:**

- 提供 `/config init [project|global] [--force]` 命令,一键生成包含所有字段的完整配置模板
- 模板字段值合理(对齐各模块运行时默认),用户改值即可生效
- 复用现有 `writeConfig` 基础设施,零新依赖
- 默认防止覆盖已存在配置(`--force` 才覆盖)
- 为 `/config` 命令组预留扩展结构(未来可加 `edit`/`show`/`path`)

**Non-Goals:**

- 不实现 `/config` 其他子命令(仅 `init`)
- 不修改 `readConfig`/`writeConfig`/`deepMerge` 语义
- 不做交互式 wizard 生成
- 不在模板里加 JSON 注释(JSON 标准不支持,`readConfig` 用 `JSON.parse`)
- 不修改 `/setting` 页面或 `Setting<T>` 抽象
- 不引入配置 schema 校验

## Decisions

### 决策 1:模板内容 = 全字段默认值(非空对象、非 JSONC)

| 备选 | 评估 | 结论 |
|------|------|------|
| 空对象 `{}` | 用户看不到可用字段,违背"一目了然" | 否决 |
| JSONC(带 `//` 注释) | `readConfig` 用 `JSON.parse` 会报错,需引入 strip-comments 预处理,复杂度高 | 否决 |
| **全字段默认值(选用)** | 合法 JSON,`readConfig` 可直接回读;用户看到所有字段名 + 参考值,改值即可 | 采用 |

**默认值选取原则**:
- 布尔/数字类:用各模块已有的 `DEFAULT_*` 常量或 `getDefault*Config()` 函数,**不重复硬编码**(单一真相源,防漂移)
- 字符串数组类(`instructions`/`skills.paths`/`skills.disabled`):空数组 `[]`
- 空对象类(`providers`/`display`):`{}`(表示"无自定义,走默认")
- **无有意义默认值的可选字段(`model`)**:**省略该 key**(对象里写 `model: undefined`,`JSON.stringify` 自然丢弃)。`model` 取决于用户选择的 provider,放占位字符串会误导。用户需要时自行添加,文档说明。这是 `JSON.stringify` 的标准行为,非 bug
- **默认关闭且结构极复杂的字段(`contextPruning`)**:只放最小合法默认 `{ enabled: false }`。原因:`DEFAULT_CONTEXT_PRUNING` 类型是 `ContextPruningConfig`(resolved,字段全 required),而 `Config.contextPruning` 是 `ContextPruningUserConfig`(全 optional,嵌套用 `Partial`),`ContextPruningConfig` 通过 `Omit` 重定义了 6 个嵌套字段,**类型不兼容无法直接引用**。DCP 默认 opt-out(`enabled: false`),用户启用后再参考 `DEFAULT_CONTEXT_PRUNING` 展开细节。不引入第二个真相源

### 决策 2:模板函数 `getDefaultConfigTemplate()` 放在 `src/config.ts`

| 备选 | 评估 | 结论 |
|------|------|------|
| 放 `src/tui/commands.ts` | 命令处理逻辑混入数据定义,职责不清 | 否决 |
| 单独建 `src/config-template.ts` | 文件爆炸;config.ts 是配置相关函数的天然归属 | 否决 |
| **放 `src/config.ts`(选用)** | 紧邻 `Config` 接口定义;字段扩展时一处更新;纯函数易测试 | 采用 |

### 决策 3:命令结构 `/config <sub>` 而非 `/initconfig`

| 备选 | 评估 | 结论 |
|------|------|------|
| `/initconfig` | 未来加 `/showconfig`、`/editconfig` 命令名膨胀 | 否决 |
| **`/config init`(选用)** | `/config` 作命名空间,预留 `edit`/`show`/`path`;tab 补全抵消多打字成本 | 采用 |

### 决策 4:覆盖保护用 `--force` flag,默认报错

| 备选 | 评估 | 结论 |
|------|------|------|
| 不加保护 | 误执行丢配置,不可逆 | 否决 |
| 交互式 y/N 确认 | headless/serve 模式难处理;现有命令无交互先例 | 否决 |
| **`--force` flag(选用)** | 显式、可脚本化、Unix 惯例(`rm -f`/`cp -f`) | 采用 |

存在检测用 `existsSync(path)`,简单直接;不做备份(超 MVP,文档提示用 git)。

### 决策 5:scope 参数大小写不敏感,缺省 = `project`

- `project`(缺省):更安全,不污染用户 home 目录
- `global`:用户显式要求才写全局
- 大小写不敏感:`args.toLowerCase()` 容忍输入
- 未识别值(如 `user`)报错并列出合法值

### 决策 6:handler 整体 try-catch,writeConfig 异常可恢复反馈

`writeConfig` 内部 `writeFileSync` 可能抛 `EACCES`(权限)/`ENOENT`(路径异常)等系统错误。整个 handler 的**写入路径**须包裹 `try-catch`,捕获后用 `formatError(e)` 格式化,通过 `createAssistantMessage` 反馈,不中断 session。

| 备选 | 评估 | 结论 |
|------|------|------|
| 让异常冒泡到全局 handler | 现有命令(`/dcp on`/`/model`)均自处理 try-catch,冒泡会破坏一致性 | 否决 |
| **handler 内 try-catch(选用)** | 与现有命令错误处理模式一致,用户体验好,session 不中断 | 采用 |

## 数据流

```
用户输入: /config init global --force
           │
           ▼
┌──────────────────────────────────────────┐
│ /config handler (src/tui/commands.ts)    │
│                                          │
│  1. args.split(/\s+/) → ["init",        │
│       "global", "--force"]              │
│  2. subcommand = args[0] = "init"        │
│  3. scope = args[1] ?? "project"         │
│     (toLowerCase, validate)              │
│  4. force = args.includes("--force")     │
│                                          │
│  5. target path:                         │
│     global  → ~/.config/openagent/       │
│               config.json                │
│     project → <cwd>/.openagent/          │
│               config.json                │
│                                          │
│  6. existsSync(target)?                  │
│     ├─ yes && !force → 报错返回          │
│     ├─ yes && force  → 继续(覆盖)       │
│     └─ no            → 继续              │
└──────────────┬───────────────────────────┘
               │ (文件可写)
               ▼
┌──────────────────────────────────────────┐
│ getDefaultConfigTemplate()               │
│ (src/config.ts, 新增纯函数)              │
│                                          │
│  return {                                │
│    // model: 省略 (undefined, JSON       │
│    //       stringify 丢弃, 无意义默认) │
│    thinking: { level: "medium",          │
│               collapsed: false },        │
│    providers: {},                        │
│    display: {},                          │
│    compaction: { enabled: true,          │
│       reserveTokens: 4096,               │
│       keepRecentTokens: 8192 },          │
│    skills: { paths: [], autoLoad: true,  │
│              disabled: [] },             │
│    notifications:                        │
│       getDefaultNotificationsConfig(),   │
│    teams: { ...DEFAULT_TEAM_CONFIG },    │
│    contextPruning: { enabled: false },   │
│    instructions: [],                     │
│  }                                       │
└──────────────┬───────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────┐
│ writeConfig(cwd, template, scope)        │
│ (src/config.ts, 已存在)                  │
│                                          │
│  - mkdirSync(recursive)                  │
│  - JSON.stringify(tmpl, null, 2) + "\n"  │
│  - writeFileSync                         │
└──────────────┬───────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────┐
│ createAssistantMessage(...)              │
│  ✓ 已生成 / ✓ 已覆盖 + 路径              │
│  + 「编辑后自动生效(readConfig 合并)」  │
└──────────────────────────────────────────┘
```

## Risks / Trade-offs

- **[风险] 默认值漂移** —— `getDefaultConfigTemplate()` 内手写值可能与运行时真实默认不符。
  → **缓解**:`teams` 引用 `DEFAULT_TEAM_CONFIG`、`notifications` 引用 `getDefaultNotificationsConfig()`,单一真相源;测试断言 `resolveTeamConfig(template.teams)` 与 `resolveNotificationsConfig(template.notifications)` 不抛异常且返回值与直接调 resolve 一致。

- **[风险] 字段遗忘** —— 新增 Config 字段时忘记加进模板。
  → **缓解**:模板放 `config.ts` 紧邻 `Config` 接口;测试断言 `Object.keys(getDefaultConfigTemplate())` 覆盖 `Config` 所有顶层字段(用类型推导枚举)。

- **[权衡] 全字段 vs 最小集** —— 全字段更"一目了然"但文件较长(~40 行 JSON)。
  → 已选全字段,对齐用户诉求。

- **[风险] `--force` 误覆盖** —— 用户误加 flag 丢配置。
  → **缓解**:反馈消息明确标注"已覆盖原文件";不做交互确认(headless 不友好);不备份(超 MVP);文档提示用 git 管理配置文件。

- **[权衡] 模板生成 = 全默认值** —— 用户生成后不改任何字段,该配置等价于无配置(readConfig 隐式默认相同)。
  → 可接受:模板价值在"展示可用字段供用户按需修改",非"改变行为"。消息提示用户"按需修改字段"。

- **[已解决] `contextPruning` 类型不兼容** —— `DEFAULT_CONTEXT_PRUNING` 是 `ContextPruningConfig`(resolved,字段全 required),而 `Config.contextPruning` 是 `ContextPruningUserConfig`(全 optional,嵌套用 `Partial`),`ContextPruningConfig` 通过 `Omit` 重定义了 6 个嵌套字段(compress/strategies/commands/manualMode/turnProtection/experimental)为 required,**类型不兼容无法直接引用**。
  → **决策**:模板只放 `{ enabled: false }`(最小合法 `ContextPruningUserConfig`,DCP 默认 opt-out)。用户启用 DCP 后自行展开,参考 `DEFAULT_CONTEXT_PRUNING`。不引入第二个真相源。

- **[已解决] `undefined` 被 `JSON.stringify` 丢弃** —— `model: undefined` 在序列化后不会出现在 JSON 中。
  → **决策**:这是 `JSON.stringify` 标准行为,非 bug。`model` 无有意义默认值(取决于用户 provider),省略它合理。用户需要时自行添加。反馈消息提示"可选字段 model 未包含,按需添加"。

- **[已解决] handler 缺 try-catch** —— `writeConfig` 内部 `writeFileSync` 可能抛 `EACCES`/`ENOENT`。
  → **决策**:写入路径整体 `try-catch`,捕获后 `formatError` + `createAssistantMessage` 反馈,不中断 session(见决策 6)。

- **[风险] `--force` 误覆盖全局配置** —— `~/.config/openagent/config.json` 可能含用户精心调优的 providers/API keys,误执行 `/config init global --force` 即丢失。
  → **缓解**:`scope=global` 且 `--force` 覆盖时,反馈消息**额外提醒**"全局配置已被覆盖,建议用 git 或备份恢复"。不做交互确认(headless 不友好);不做备份(超 MVP)。

- **[权衡] 模板生成 = 全默认值** —— 用户生成后不改任何字段,该配置等价于无配置(readConfig 隐式默认相同)。
  → 可接受:模板价值在"展示可用字段供用户按需修改",非"改变行为"。消息提示用户"按需修改字段"。

## Migration Plan
- 回滚:删除新增的 `getDefaultConfigTemplate()` 函数与 `/config` 命令注册块即可,不影响任何已存在的配置文件或运行时行为。

## Open Questions

(无 —— 所有设计点已通过用户澄清与代码库探索确认。`contextPruning` 默认值来源为实现时细节,不阻塞设计。)
