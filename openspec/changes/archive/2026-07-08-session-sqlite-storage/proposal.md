## Why

当前 session 存储基于 Pi SDK 的 append-only JSONL 文件（`~/.config/openagent/sessions/<cwd-hash>/*.jsonl`），每个 entry 一行 JSON。这套方案有三个问题：

1. **列表/搜索低效**：`/sessions` 命令需要遍历所有 .jsonl 文件、逐行解析 JSON 才能拿到 SessionInfo（首条消息、消息数、修改时间）。session 数量增长后，list 操作是 O(总 entry 数) 的全盘扫描。
2. **compaction 需全文件重写**：SDK 的 `_rewriteFile()` 用 `openSync("w")` 截断后重写全部 `fileEntries`。session 越长，压缩时的 I/O 开销越大，且有写入中断导致数据损坏的风险（无事务保护）。
3. **缺乏结构化查询能力**：JSONL 是纯追加日志，无法按 sessionId / parentId / type 做索引查询。分支（branch）、按 id 恢复等操作都依赖全文件扫描后在内存建索引。

迁移到 SQLite（`bun:sqlite` + Drizzle ORM）可以解决上述三点：事务保护的原子写入、索引化的快速查询、单文件存储的简洁性。opencode 生产环境已验证这套技术栈。

## What Changes

- **新增 `installSqliteBackend()` 类级 patch**（`src/session/install-sqlite-backend.ts` + `src/session/sdk-internals.ts`）：在应用启动时一次性 patch `SessionManager.prototype` 的 6 个实例方法（`_persist`/`_rewriteFile`/`setSessionFile`/`createBranchedSession`/`isPersisted`/`newSession`）+ `SessionManager` 的 5 个静态方法（`create`/`open`/`continueRecent`/`list`/`listAll`），把持久化层从 JSONL 换成 SQLite。**类级 patch（而非实例级 wrapper）是必须的**：SDK 的 `AgentSessionRuntime`（`agent-session-runtime.js`）在 `/new`/`/fork`/`/clone`/`/import`/`/resume` 等运行时操作中直接调 `SessionManager.create/open` 静态方法（5 个调用点），实例级 wrapper 覆盖不了。SQLite 模式实例通过实例级标志 `__sqliteStore` 区分（Oracle 评审 P0 修正）。
- **新增 SQLite 存储层**（`src/session/sqlite-store.ts`）：Drizzle ORM schema（`session` + `entry` 两表）+ `SessionStore` 类（CRUD / list / find-recent / bulk-import）。`entry.data` 列存 JSON blob，`sort_order` 保插入顺序，与 SDK `loadEntriesFromFile` 的 `FileEntry[]` 返回类型一一对应。
- **首次启动自动迁移**（`src/session/migrate.ts`）：DB 空 + 旧 `sessions/*.jsonl` 存在 → 单事务导入全部历史 session → 旧目录改名 `sessions.bak/`。用户无感升级，失败自动回滚不破坏原数据。
- **新增集中路径模块**（`src/utils/paths.ts`）：提取 22 处硬编码的 `~/.config/openagent/...` 路径为常量 + resolver，统一引用入口，为后续 XDG 化预留 hook。
- **更新调用点**：`createRuntime`（src/agent/session.ts）入口最先调 `installSqliteBackend()`；`buildSessionManager` 的 `SessionManager.create/open/continueRecent` 调用不变（自动走 patched 版本）；`createMember`/`restoreMembers`（src/teams/manager-v2.ts）的 `SessionManager.create/open` 调用不变；`listSessions`（src/session/list.ts）改用 patched `SessionManager.list` 或直接 SessionStore；`sessionTeamDir`（src/server/index.ts）改用 `parseSessionIdFromUri` + 新 team 目录路径；sessionFile 语义从 `.jsonl` 路径变为合成标识 `sqlite://<sessionId>`。
- **Team 目录迁移**：旧 `~/.config/openagent/sessions/<cwd-hash>/team/<sessionId>/` 迁到新 `~/.config/openagent/team/<sessionId>/`（脱离 sessions 目录，避免 sessions 改名 sessions.bak 后路径失效）。迁移时遍历旧 team 子目录搬到新位置。
- **spec 更新**：`session-persistence` 和 `team-session-restore` 两个 spec 从描述 JSONL 改为描述 SQLite 持久化。

## Non-goals

- **不实现 XDG Base Directory**：paths 模块预留 hook 但本次不迁移到 `XDG_DATA_HOME`，仍用 `~/.config/openagent/`。
- **不替换 SDK 的内存逻辑**：树结构、压缩（compaction）、分支（branch）仍走 SDK SessionManager 的内存算法，只换持久化层。
- **不引入 Drizzle Kit migration 工具链**：schema 用代码内联定义（`sqliteTable`），不引入 `drizzle-kit` CLI 和 migration 文件管理。
- **不做 per-project 多 DB**：单一全局 DB（`~/.config/openagent/sessions.db`），session 表用 `cwd` 列区分项目。
- **不删 `sessions.bak/` 旧 JSONL**：迁移后旧目录改名保留，用户手动确认后再删。
- **不做读取兼容模式**：迁移完成后存储层是 SQL-only，不再支持读写 JSONL（只保留一次性迁移导入）。
- **不动 team member 的 `.openagent/team/` Markdown 记忆**：TEAM.md、member index、member memory 仍是 Markdown 文件，只 session 消息流迁到 SQLite。
- **不改 SDK 包的 SessionManager 源码**：只通过 monkey-patch 在运行时重写方法，不 fork / patch package 文件。

## Capabilities

### Modified Capabilities

- `session-persistence`: 持久化后端从 append-only JSONL 改为 SQLite（`bun:sqlite` + Drizzle ORM）。新建/恢复/列表/命名的 Requirement 全部更新存储语义。新增"首次启动自动迁移"Requirement。
- `team-session-restore`: 成员 session 的创建/恢复路径从 SDK 静态方法 `SessionManager.create/open` 切换到 `SQLiteSessionManager.create/open`；`sessionFile` 语义从 `.jsonl` 路径变为 `sqlite://<sessionId>` 合成标识。

### New Capabilities

（无 — 本次是对现有 session-persistence / team-session-restore 两个 capability 的存储后端替换，不引入新 capability。）

## Impact

- **新增文件**：
  - `src/utils/paths.ts` — 集中路径模块
  - `src/session/sqlite-store.ts` — Drizzle schema + SessionStore
  - `src/session/install-sqlite-backend.ts` — 类级 patch 入口（核心）
  - `src/session/sdk-internals.ts` — SDK private 字段集中访问辅助
  - `src/session/migrate.ts` — JSONL→SQLite 一次性迁移
  - `tests/paths.test.ts` / `tests/sqlite-store.test.ts` / `tests/sqlite-session-manager.test.ts` / `tests/migrate.test.ts`

- **修改文件**：
  - `src/agent/session.ts` — `createRuntime` 入口最先调 `installSqliteBackend()`
  - `src/session/list.ts` — list/rename 实现改用 SessionStore 查询
  - `src/session/storage.ts` — 路径走新 paths 模块；`resolveMemberSessionPath` 语义调整
  - `src/teams/manager-v2.ts` — sessionId 提取从 `basename().replace(/\.jsonl$/)` 改为解析 `sqlite://` 前缀（`SessionManager.create/open` 调用不变，自动走 patched）
  - `src/server/index.ts` — `sessionTeamDir()` 适配新的 sessionFile 语义
  - `package.json` — 新增 `drizzle-orm` 依赖

- **依赖**：
  - 新增 `drizzle-orm`（运行时 ORM）
  - `bun:sqlite` 是 Bun 内置，无需新增依赖
  - pin `@earendil-works/pi-coding-agent`（wrapper 依赖其 private 字段，升级需重新验证）

- **风险**：
  - wrapper 依赖 SDK SessionManager 的 private 字段（`fileEntries`/`byId`/`leafId`/`sessionId`/`sessionFile`/`flushed`），SDK 升级可能改名 → 通过 pin 版本 + 启动时结构断言缓解
  - 迁移失败可能损坏历史数据 → 单事务 + 失败回滚 + 原目录改名 `sessions.bak` 双保险
