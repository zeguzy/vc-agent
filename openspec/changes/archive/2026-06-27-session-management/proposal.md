## Why

openagent 当前用 `SessionManager.inMemory()` 创建会话（`src/agent/session.ts:73`），进程一退出全部对话上下文即丢失，用户无法恢复之前的聊天，也无法在多个会话之间切换。Pi SDK 其实原生提供完整的会话持久化（`SessionManager.create/open/continueRecent/list`，append-only JSONL）与运行时热切换（`AgentSessionRuntime.switchSession/newSession` + `setRebindSession` 重绑钩子）能力，只是 openagent 显式选了纯内存模式。本次改动把会话切换到磁盘持久化、用 `AgentSessionRuntime` 承载当前会话以支持 TUI 内运行时热切换，并补齐 CLI 入口与多会话列表管理，让 openagent 具备「重启可续、多会话可管、运行时可切换」的会话能力。

## What Changes

- **会话持久化**：`createSession` 默认改用磁盘 `SessionManager`（写入 `~/.config/openagent/sessions/`，不污染 `~/.pi/`）；SDK 在创建时自动检测并恢复历史 messages / model / thinkingLevel。
- **AgentSessionRuntime 承载当前会话**：启动时用 `createAgentSessionRuntime(factory, opts)` 创建 runtime，`App` 持有 `runtime`（而非 `session`），`runtime.session` 为当前会话；通过 `runtime.setRebindSession` 注册切换重绑钩子。
- **TUI 内运行时热切换**：`/sessions` 列表选中、`/resume`、`/new` 直接调 `runtime.switchSession(path)` / `runtime.newSession()`，SDK 内部完成旧会话 teardown + 新会话创建，rebind 钩子触发 UI 重绑事件订阅 + 重新渲染历史消息。**无需重启进程**。
- **历史消息渲染**：会话切换/恢复后，把 SDK `buildSessionContext()` 重建出的 messages 映射为 TUI 的 `Message[]`（user/assistant+thinking/tool 摘要/separator）。
- **CLI 启动参数**（对齐 pi/opencode 习惯）：`-c/--continue`（恢复最近）、`-r/--resume`（启动后打开会话列表选择）、`--session <path|id>`（指定）、`-n/--name <name>`（启动时命名）；无参数时启动新的持久化会话。
- **TUI 斜杠命令**：`/sessions`（别名 `/resume` `/continue`，打开会话列表，选中后热切换）、`/new`（热切换到新会话）、`/name <text>`（命名当前会话，SDK 自动持久化）。

## Capabilities

### New Capabilities

- `session-persistence`: 会话的磁盘持久化、进程重启后恢复历史上下文、以及多会话的列表 / 打开 / 命名管理。

### Modified Capabilities

- `agent-session`: `createSession` 从「固定纯内存 + 返回 session」改为「按启动意图选择 SessionManager 模式 + 返回 `AgentSessionRuntime` 包装」；新增会话热切换与历史渲染行为。
- `cli-entry`: 新增 `-c/--continue` / `-r/--resume` / `--session <path|id>` / `-n/--name` 启动参数（对齐 pi/opencode）。
- `tui-input`: 新增 `/sessions`（含别名）`/resume` `/new` `/name` 命令，`/sessions` `/new` 走运行时热切换。

## Non-goals

- **不自建持久化格式**：直接用 Pi SDK 的 append-only JSONL，不另造存储 / 重放层。
- **不做 fork / clone / tree 导航**：SDK 的 `--fork` / `/fork` / `/tree` / `/clone` 不在 MVP（`runtime.fork` API 已具备，后续可加）。
- **不做会话导入导出**：SDK 的 `/import` / `/export` / `exportToJsonl` 不在 MVP。
- **不做会话列表高级 UX**：opencode 的搜索、pin、quick-switch 数字槽、行内 delete 二次确认不在 MVP；MVP 列表只做时间分组 + 预览 + 选中切换 + 当前高亮。
- **不做 `--no-session` 临时模式**、`--session-dir` 自定义目录（MVP 固定 `~/.config/openagent/sessions/`）。
- **不改 AuthStorage / ModelRegistry / SettingsManager**：三者保持 `inMemory()`，会话恢复仅依赖 `SessionManager` 磁盘化。
- **不做并发 / 多进程锁**、不做跨项目 fork、不做旧内存会话迁移。

## Impact

- **代码**：
  - `src/agent/session.ts`：`createSession` 重构——抽出 runtime factory（封装 auth/model/settings/skill/mcp 初始化 + `createAgentSession`），导出 `createRuntime(opts)` 用 `createAgentSessionRuntime` 创建 runtime；按 mode 构造 SessionManager。
  - `src/index.tsx`：`parseArgs` 新增 `-c/-r/--session/-n`，调 `createRuntime` 传 `runtime` 给 App；`-r` 启动后触发会话列表。
  - `src/tui/App.tsx`：`props.runtime`（替代 `props.session`）；`useState(runtime.session)`；注册 `runtime.setRebindSession` 钩子（`setSession` + 重映射历史 + 重置 UI）；`useEffect [session]` 自动重绑事件订阅。
  - `src/tui/commands.ts` + `registry.ts`：注册 `/sessions`（`/resume`/`/continue` 别名）、`/new`、`/name`；`/sessions` `/new` 调 runtime 热切换。
  - 新增 `src/session/`（目录策略 + 会话列表 + SDK→TUI 消息映射）；新增会话列表组件。
- **数据**：新增 `~/.config/openagent/sessions/--<encoded-cwd>--/<timestamp>_<id>.jsonl` 存储。
- **依赖**：无新增；`@earendil-works/pi-coding-agent@0.79.10` 已具备 `AgentSessionRuntime` / `createAgentSessionRuntime` / `setRebindSession` / `switchSession` / `newSession` / `SessionManager.{create,open,continueRecent,list}`。
- **向后兼容**：默认行为从「内存新建」变为「磁盘新建 + runtime 承载」，旧内存会话无历史可迁移。
