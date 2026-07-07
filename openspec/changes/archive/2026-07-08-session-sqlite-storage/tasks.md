# Tasks: session-sqlite-storage

## Phase A: Foundation

### [ ] A1: 新增 drizzle-orm 依赖
- `package.json` 添加 `drizzle-orm`（runtime 依赖）
- 确认 `bun:sqlite` 是 Bun 内置无需安装
- pin `@earendil-works/pi-coding-agent` 到当前版本（0.79.10）
- 验证：依赖安装成功，`import { drizzle } from "drizzle-orm/bun-sqlite"` 可用

### [ ] A2: 实现 src/utils/paths.ts 集中路径模块
- 提取核心常量：`AGENT_CONFIG_DIR`、`sessionsDbPath`、`sessionsLegacyDir`、`sessionsBackupDir`、`teamDirForSession`
- 实现 resolver 函数（覆盖当前散落的路径构造，含 home override 测试钩子）
- 验证：`tests/paths.test.ts` 至少 20 个用例覆盖核心 resolver

### [ ] A3: 让 src/session/storage.ts 复用 paths 模块
- `sessionDirRoot`/`resolveSessionDir` 内部走 paths 模块
- `resolveMemberSessionPath` / `validateMemberSessionPath` 标记废弃（Phase E2 移除调用）
- 新增 `parseSessionIdFromUri(uri)` 工具函数（解析 `sqlite://<id>` 前缀）
- 验证：现有调用点不报错，`bun run check` 通过

## Phase B: SQLite Store

### [ ] B1: 实现 src/session/sqlite-store.ts 的 Drizzle schema
- 定义 `session` 表（id PK / cwd / created_at / parent_session / name）
- 定义 `entry` 表（session_id / sort_order / type / parent_id / timestamp / data JSON）
- 定义索引（idx_entry_session / idx_session_cwd / idx_session_cwd_created）
- 开启 WAL 模式（`db.run("PRAGMA journal_mode = WAL;")`）
- SessionStore 单例管理（共享 Database 实例避免多连接 SQLITE_BUSY）
- 验证：`tests/sqlite-store.test.ts` schema 创建用例通过

### [ ] B2: 实现 SessionStore 的 CRUD 方法
- `createSession(id, cwd, parentSession?)` — 插入 session 记录
- `insertEntry(sessionId, sortOrder, entry)` — 插入单条 entry
- `rewriteAll(sessionId, entries)` — 事务内 DELETE + INSERT ALL（用于 compaction）
- `loadEntries(sessionId)` — 按 sort_order 排序返回 FileEntry[]
- `getSession(id)` / `setSessionName(id, name)`
- 验证：CRUD 测试用例覆盖 happy path + 边界（空 entries / 不存在的 sessionId）

### [ ] B3: 实现 SessionStore 的查询 + 迁移方法
- `listSessions(cwd)` — 返回 SessionInfo[]（按 created_at DESC，含首条消息预览 / 消息数 / 名称）
- `findRecent(cwd)` — 按 cwd + created_at DESC 取第一条
- `bulkImport(sessions)` — 单事务批量导入（迁移用），失败 ROLLBACK
- `count()` — session 表行数（迁移检测用）
- 验证：list/findRecent 用多 session + 多 cwd 数据测试；bulkImport 测试含失败回滚

## Phase C: installSqliteBackend 类级 patch

### [ ] C1: 实现 sdk-internals.ts + install-sqlite-backend.ts 入口
- `src/session/sdk-internals.ts`：`getSdkInternals(inst)` / `setSqliteStore(inst, store)` / `getSqliteStore(inst)` 集中 private 字段访问
- `src/session/install-sqlite-backend.ts`：`installSqliteBackend()` 入口（幂等 + assertSdkStructure + migrateIfNeeded + patchPrototype + patchStatic）
- `getOrCreateStore()` SessionStore 单例管理
- 验证：骨架编译通过

### [ ] C2: patch SessionManager.prototype 的 6 个实例方法（lazy create 策略）
- `_persist(entry)` — 检查 `__sqliteStore`，有则 `ensureSessionRecord`（lazy create session 记录+header）+ `insertEntry(sessionId, fileEntries.length-1, entry)`（O(1) sortOrder）；无则走原逻辑
- `_rewriteFile()` — 检查 `__sqliteStore`，有则 `ensureSessionRecord` + `store.rewriteAll(sessionId, fileEntries)`（sort_order 用数组 index 0..n-1）；无则走原逻辑
- `setSessionFile(uri)` — 检查 `__sqliteStore`，有则从 SQLite 加载 + 调 SDK `_buildIndex()` 重建全部 4 个内存索引（byId/leafId/labelsById/labelTimestampsById）；无则走原逻辑
- `newSession(options?)` — 检查 `__sqliteStore`，有则调原始逻辑 + **只设 `sessionFile=sqlite://<id>`，不写 DB**（lazy create 延迟到 _persist）；无则走原逻辑
- `createBranchedSession(leafId)` — 检查 `__sqliteStore`，有则先保存原 sessionId 作 parent + 调原始逻辑 + **patch header.parentSession=parentSessionId**（SDK in-memory 分支构造的 header.parentSession=undefined）+ DB createSession + rewriteAll；无则走原逻辑
- `isPersisted()` — 检查 `__sqliteStore`，有则返回 true；无则返回原 `this.persist`
- `ensureSessionRecord(store, internals)` 辅助：首次调用时若 session 记录不存在，createSession + insertEntry(header, sort_order=0)
- 验证：`tests/install-sqlite-backend.test.ts` 覆盖每个 prototype patch（含 SQLite 模式 vs 非 SQLite 模式分支）+ lazy create 幂等性 + newSession 多次调用无孤儿

### [ ] C3: patch SessionManager 的静态方法 + SDK 结构断言
- patch `create(cwd)` — **同步**（SDK 原版同步，agent-session-runtime.js 无 await）；inMemory(cwd) + 挂 __sqliteStore，**不调 newSession**（inMemory 构造函数已调，实例已有 sessionId）
- patch `open(sessionFile)` — **同步**；兼容 `sqlite://<id>`（从 DB 加载）和真实 .jsonl 路径（importJsonlToDb 导入 DB 再加载）
- patch `continueRecent(cwd)` — **同步**；findRecent 无则 create
- patch `list(cwd)` / `listAll(cwd)` — **async**（SDK 原版 async）；SQL 查询
- `getOrCreateStore()` 同步返回单例（installSqliteBackend 完成后已初始化）
- `assertSdkStructure(SessionManager)` — 启动检查 private 字段（fileEntries/byId/leafId/sessionId/sessionFile/flushed/persist）+ 静态方法清单（create/open/continueRecent/list/listAll）
- 字段缺失时抛清晰错误（含 SDK 版本号 + 依赖清单）
- 验证：静态方法 patch 测试（create/open/continueRecent/list，验证同步签名）+ 结构断言测试（mock 缺字段抛错）

## Phase D: Migration

### [ ] D1: 实现 src/session/migrate.ts（JSONL 迁移）
- `migrateIfNeeded()` — 检测 DB session 表为空 **且** legacyDir 存在 .jsonl 文件
- 迁移流程：遍历 legacyDir 子目录 → 逐 .jsonl 文件 loadEntriesFromFile → bulkImport（单事务，含 header 作为 entry）
- 成功：检测 `sessions.bak` 已存在则报错（不覆盖）；不存在则 `sessions/` 改名 `sessions.bak/`
- 失败：ROLLBACK + 抛错 + 不改名
- 幂等：DB 已有数据则跳过
- 验证：`tests/migrate.test.ts` 覆盖（空 DB + 有 JSONL / DB 已有数据 / 迁移失败回滚 / sessions.bak 已存在报错 / 改名成功）

### [ ] D2: Team 目录迁移
- migrateIfNeeded 成功后，遍历旧 `sessions/<cwd-hash>/team/` 下所有 `<sessionId>/` 子目录
- 搬到新 `~/.config/openagent/team/<sessionId>/`（用 paths 模块的 `teamDirForSession`）
- 验证：迁移后 team 目录在新位置，member memory/index/TEAM.md 完整

## Phase E: 调用点接入

### [ ] E1: src/agent/session.ts createRuntime 入口加 installSqliteBackend()
- `createRuntime` 最先调 `await installSqliteBackend()`（早于任何 SessionManager.create/open）
- `buildSessionManager` 的 SessionManager.create/open/continueRecent 调用不变（自动走 patched）
- 验证：TUI 启动 / --continue / --session 三种模式能创建/恢复 session

### [ ] E2: src/teams/manager-v2.ts sessionId 提取适配
- createMember（line 222-224）/ restoreMembers（line 344-346）：`basename().replace(/\.jsonl$/,"")` → `parseSessionIdFromUri(session.sessionFile)`
- SessionManager.create/open 调用不变（自动走 patched）
- 移除 `resolveMemberSessionPath` / `validateMemberSessionPath` 调用（改为 sessionId 直接传递 + validateSessionId 校验）
- 验证：createMember + restoreMembers 测试通过

### [ ] E3: src/session/list.ts listSessions 适配
- 实现改为调 patched `SessionManager.list(cwd)` 或直接 `SessionStore.listSessions(cwd)`
- rename 实现改为 `SessionStore.setSessionName(id, name)`
- 验证：/sessions 命令返回正确列表

## Phase F: sessionFile 解析适配

### [ ] F1: 适配 src/teams/manager-v2.ts 的 sessionId 提取
- 已在 E2 完成（parseSessionIdFromUri 替换 basename.replace）
- 验证：member 创建后 sessionId 正确提取

### [ ] F2: 适配 src/server/index.ts 的 sessionTeamDir()
- line 137-144：`basename(sf).replace(/\.jsonl$/,"")` + `dirname(sf)` → `parseSessionIdFromUri(sf)` + `teamDirForSession(sessionId)`
- 验证：team 目录路径指向新 `~/.config/openagent/team/<sessionId>/`

## Phase G: 集成验证

### [ ] G1: 全量 bun run check
- typecheck + lint + test 全绿
- 修复本变更引入的任何 lint warning（新代码不引入 `any`，private 字段访问集中在 sdk-internals.ts）
- 验证：`bun run check` exit 0

### [ ] G2: 迁移 + SDK runtime 路径端到端验证
- 在含历史 .jsonl + team 目录的真实 sessions 目录上跑迁移 → 验证 DB 数据完整 + team 目录搬到新位置
- 启动 TUI → 创建 session → 发消息 → 重启 --continue 恢复 → 验证上下文连续
- **SDK runtime 路径验证（Oracle P0 重点）**：
  - `/new` 命令 → 验证走 patched create，新 session 在 DB，**不写 ~/.pi/**
  - `/fork` 命令 → 验证走 patched open + createBranchedSession，分支在 DB
  - `/resume` 切换 → 验证走 patched open，从 DB 加载
- 创建 team member → 切换 session → restoreMembers → 验证 member 恢复
- 验证：上述场景全部正常

### [ ] G3: 更新 AGENTS.md（如需）
- 在"通知系统"或相关段落补充 SQLite 存储说明（DB 路径 / 迁移行为 / sessions.bak / team 目录新位置）
- 验证：文档与实现一致
