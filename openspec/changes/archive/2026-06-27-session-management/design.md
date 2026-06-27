## Context

openagent 当前在 `src/agent/session.ts:73` 硬编码 `SessionManager.inMemory()`，四件套全走内存，进程退出即丢失全部对话。

Pi SDK（`@earendil-works/pi-coding-agent@0.79.10`，已安装）原生提供两套相关能力：
1. **会话持久化**：`SessionManager.create/open/continueRecent/list`，append-only JSONL；`createAgentSession` 内建恢复逻辑（自动 `buildSessionContext` + 注入 messages + 恢复 model）。
2. **运行时热切换**：`AgentSessionRuntime`（`createAgentSessionRuntime` 工厂）承载「当前 session + cwd-bound services」，`switchSession(path)` / `newSession()` / `fork(entryId)` 内部完成旧会话 teardown + 新会话创建，`setRebindSession(callback)` 给宿主 UI 一个切换后重绑的钩子（callback 收到新 session）。

openagent 需要：(1) 切到磁盘持久化；(2) 用 runtime 承载会话使 TUI 内可热切换；(3) 提供 CLI 与 TUI 双入口。**参考了 sst/opencode 的会话架构**（见 Decision 6），其热切换核心是「无状态 DB 记录 + 全局响应式 store + 路由切换」；我们采用更轻的 B 路线——用 SDK 自带的 `AgentSessionRuntime` 而非自研持久化层，但借鉴 opencode 的 UX 与「App 持有 sessionID 而非有状态对象」的思路（我们的对应物是「App 持有 runtime，runtime.session 随切换变更」）。

约束：
- 不自建持久化格式 / 重放层（直接用 SDK append-only JSONL）。
- 不动 AuthStorage/ModelRegistry/SettingsManager（保持 `inMemory()`，key 仍来自 openagent `config.json`）。
- 单进程 TUI，无并发锁需求。

## Goals / Non-Goals

**Goals:**
- 进程重启后能恢复上一次会话的完整对话上下文（含 model / thinkingLevel）。
- **TUI 内运行时热切换**会话（`/sessions` 选中、`/resume`、`/new`），不重启进程。
- 支持多会话：列出当前 cwd 的会话、按 path/id 打开、命名。
- CLI 与 TUI 双入口都能触发恢复与新建。
- 会话数据写在 openagent 自己的目录，不污染 `~/.pi/`。

**Non-Goals:**
- fork / clone / tree 导航（`runtime.fork` 已具备，后续加）。
- 会话导入导出（`/import` / `/export` / `exportToJsonl`）。
- 会话列表高级 UX（搜索 / pin / quick-switch / 行内 delete 二次确认）。
- `--no-session` 临时模式、`--session-dir` 自定义目录。
- 跨项目 fork、并发锁、旧内存会话迁移。

## Decisions

### 数据流与架构

```
启动:
┌───────────────┐    ┌──────────────────────────────┐
│ CLI argv      │───▶│ parseArgs                    │
│ -c/--continue │    │  现有: -h/--model            │
│ -r/--resume   │    │  新增: -c/--continue         │
│ --session p|i │    │       -r/--resume (列表)     │
│ -n/--name     │    │       --session <path|id>    │
│ (无) = 新建   │    │       -n/--name <name>       │
└───────────────┘    └────────────┬─────────────────┘
                                  │ SessionMode + name
                                  ▼
┌─────────────────────────────────────────────────┐
│ createRuntime({ mode, cwd, config, mcpConfig }) │
│  1) 按 mode 构造 SessionManager:                 │
│     new→create / continue→continueRecent /      │
│     resume→list 匹配 id→open / session→open     │
│  2) runtimeFactory = async ({cwd,sessionManager})│
│     => { 复用 auth/model/settings/skill/mcp 初始化│
│          + createAgentSession({sessionManager}) │
│          + return { session, services, ...} }   │
│  3) runtime = createAgentSessionRuntime(        │
│       runtimeFactory, {cwd, agentDir, sessionMgr})│
│  return runtime                                  │
└────────────────────┬────────────────────────────┘
                     │ AgentSessionRuntime
                     │  .session = 当前会话(含历史)
                     ▼
┌─────────────────────────────────────────────────┐
│ App(props={runtime, ...})                       │
│  const [session, setSession] = useState(runtime.session)│
│  runtime.setRebindSession(async (newSession)=>{ │
│     setSession(newSession)   // 触发 useEffect[session]│
│     setMessages(mapSdkMessagesToTui(newSession.messages))│
│     重置滚动/运行状态                            │
│  })                                              │
│  useEffect[session]: subscribe(session 事件)    │  ← 自动重绑
└────────────────────┬────────────────────────────┘
                     │ 用户操作
                     ▼
┌─────────────────────────────────────────────────┐
│ /sessions 选中 / /resume / /new:                │
│   runtime.switchSession(path) / newSession()    │
│   SDK: teardown 旧 runtime → factory 创建新 →   │
│         触发 setRebindSession(newSession)       │
│   => App 自动重绑 + 重渲染历史(无需重启)        │
└─────────────────────────────────────────────────┘

运行时写盘（SDK 自动，append-only）:
  session.prompt(text) → agent 循环 → SessionManager.appendMessage
    → ~/.config/openagent/sessions/--<encoded-cwd>--/<ts>_<id>.jsonl
```

磁盘布局：
```
~/.config/openagent/
├── config.json                          （现有）
└── sessions/                            （新增）
    └── --<encoded-cwd>--/
        ├── 1719000000_abc123.jsonl
        └── 1719100000_def456.jsonl
```

### 关键技术决策

1. **复用 SDK SessionManager + AgentSessionRuntime，不自建持久化/热切换层。**
   - 理由：SDK 的 append-only JSONL 已生产验证；`createAgentSession` 内建恢复；`AgentSessionRuntime` 已封装「teardown 旧 + factory 创建新 + rebind 钩子」的热切换全流程（`switchSession`/`newSession`/`fork`/`importFromJsonl`）。自建等于重写一遍。
   - 备选：自建 SQLite + 无状态服务（opencode 路线）→ 否决（推翻「不自建持久化」Non-goal，工作量过大；SDK runtime 已够用）。

2. **会话目录放 `~/.config/openagent/sessions/`，显式传 sessionDir。**
   - 理由：与现有 `config.json` 同根，用户只记一个目录；显式传 `sessionDir` 给 `SessionManager.create/open/continueRecent`，避免 SDK 默认写 `~/.pi/agent/sessions/`。

3. **用 `AgentSessionRuntime` 承载当前会话，App 持有 `runtime` 而非 `session`。**（核心）
   - 理由：这是运行时热切换的关键。`runtime.session` 是当前会话；`switchSession`/`newSession` 内部完成旧会话 teardown + 新会话创建，宿主 UI 通过 `setRebindSession(cb)` 钩子拿到新 session 重新绑定。若 App 直接持有 `session`，切换需手动 dispose/重绑，复杂且易错。
   - 实现要点：App 用 `useState(runtime.session)`，在 `setRebindSession` 回调里 `setSession(newSession)` + 重映射历史消息 + 重置 UI 状态；现有 `useEffect([session])` 的事件订阅会因 session 引用变化**自动 unsubscribe 旧的 + subscribe 新的**，无需手动管理。
   - 备选：App 直接持有 session，切换时手动重绑 → 否决（SDK runtime 正是为此而生）。

4. **`createSession` 重构为 runtime factory。**
   - 理由：`createAgentSessionRuntime(factory, opts)` 要求一个 factory（接收 `{cwd, agentDir, sessionManager}`，返回 `{session, services, ...}`），它会被每次会话切换复用。我们把现有 `createSession` 的 auth/model/settings/skill/mcp 初始化 + `createAgentSession` 调用抽进这个 factory，导出新的 `createRuntime(opts)`；SessionManager 按 mode 在 factory 外构造（因为不同 mode 用不同 SessionManager，但 factory 内的其他初始化是固定的）。
   - 注意：auth/model/settings/skill/mcp 在 factory 内每次重建（runtime 设计如此，cwd-bound services 随切换重建）；API key 仍来自 config.json。

5. **历史消息做角色映射渲染，tool 用摘要。**
   - 理由：TUI 的 `Message`（`src/store.ts`）与 SDK message 结构不同，需映射；rebind 钩子里复用同一映射函数。MVP 对 tool_use 渲染为 `createToolMessage(name, args, "done")` 摘要。

6. **借鉴 opencode 的 UX 与 CLI 参数命名，但不照搬其架构。**
   - 理由：sst/opencode 的会话列表 UX（时间分组 / 预览 / 当前高亮）与 CLI 参数（`-c/-r/--session/-n`，与 pi 同源）经过充分验证，直接对齐降低用户学习成本。但其「无状态 DB + 全局响应式 store」架构需要自建持久化层，与我们的 Non-goal 冲突，故只用 SDK runtime（Decision 1/3）。
   - MVP 借鉴项：会话列表按 Today/日期分组、每项显示「时间 · 首条预览 · 消息数 · 名称」、当前会话高亮、`/sessions` `/resume` `/continue` 合并为同一命令打开列表。

7. **AuthStorage/ModelRegistry/SettingsManager 保持 `inMemory()`。**
   - 理由：openagent 的 `config.json` 已是 API key 与 provider 配置的磁盘源；会话恢复只依赖 SessionManager 磁盘化（SDK 不强制四件套同模式）。

8. **`--resume <id>` / `--session <path|id>` 通过 `SessionManager.list` 匹配。**
   - 理由：`--session` 接受 path 或 id（pi 习惯），id 用 `SessionManager.list(cwd, dir)` 匹配 path 再 `open`；`-r/--resume` 启动进 TUI 后立即打开会话列表组件供用户选择。

## Risks / Trade-offs

- **[runtime factory 重构影响 createSession 现有调用方]** → factory 内每次重建 auth/model/skill/mcp，需确保这些初始化是幂等且可重复的；现有 `index.tsx` 唯一调用方一并改为 `createRuntime`。
- **[rebind 钩子时序]** → SDK 保证 `setRebindSession` 回调在新 session 创建后、旧 session 完全失效前后的正确时机触发；App 在回调里 `setSession` + 重映射，React 批量更新避免中间态闪烁。若 rebind 期间有进行中的 agent 循环，SDK 的 teardown 会先 abort。
- **[SDK 消息格式与 TUI Message 映射不完整]** → MVP 优先 user / assistant text+thinking；tool_use 摘要；未知 block 降级纯文本兜底。
- **[sessionId（UUID）对用户不友好]** → `/sessions` 列表用「时间 · 首条预览」展示，`--session` 支持 path 或 id，列表选中直接热切换（用户无需手输 id）。
- **[会话目录无限增长]** → Non-goal；MVP 不自动清理，后续可加 `/sessions --prune`。
- **[SDK 版本]** → 已确认 `0.79.10` 具备 `AgentSessionRuntime` / `createAgentSessionRuntime` / `setRebindSession` / `switchSession` / `newSession` 与 `SessionManager.{create,open,continueRecent,list}`，无需升级。
