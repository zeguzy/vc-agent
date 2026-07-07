## MODIFIED Requirements

### Requirement: 会话磁盘持久化

系统 SHALL 使用 SQLite（`bun:sqlite` + Drizzle ORM）把会话持久化到单一 DB 文件（`~/.config/openagent/sessions.db`），SHALL NOT 写入 `~/.pi/` 目录，SHALL NOT 继续使用 append-only JSONL 作为存储后端。持久化层 SHALL 通过 `installSqliteBackend()` 在应用启动时一次性 patch `SessionManager` 类实现：patch `SessionManager.prototype` 的 6 个实例方法（`_persist`/`_rewriteFile`/`setSessionFile`/`createBranchedSession`/`newSession`/`isPersisted`）+ `SessionManager` 的 5 个静态方法（`create`/`open`/`continueRecent`/`list`/`listAll`），把持久化层从 JSONL 替换为 SQLite。patch 必须在类级别（而非实例级 wrapper），因为 SDK 的 `AgentSessionRuntime`（`agent-session-runtime.js`）在 `/new`/`/fork`/`/clone`/`/import`/`/resume` 等运行时操作中直接调 `SessionManager.create/open` 静态方法（5 个调用点），实例级 wrapper 覆盖不了。SQLite 模式实例通过实例级标志 `__sqliteStore`（SessionStore 引用）区分。`AuthStorage` / `ModelRegistry` / `SettingsManager` 保持 `inMemory()`。此持久化 SHALL 同时覆盖 leader session 和 team 成员 session——两者使用相同的 patched `SessionManager` API，成员 session 记录在同一 DB 的 session/entry 表中（用 `session.cwd` 列区分项目），与 leader session 并列。TEAM.md 只持有成员的 `sqlite://<sessionId>` 引用。DB SHALL 开启 WAL 模式提升并发与崩溃恢复。

#### Scenario: 新建持久化会话

- **WHEN** 用户无恢复参数启动（`openagent`）
- **THEN** 系统 SHALL 调用 patched `SessionManager.create(cwd)`（SDK 静态方法已被 patch，同步签名）
- **AND** patched `create` SHALL 内部调 `SessionManager.inMemory(cwd)` 创建实例 + 挂 `__sqliteStore` 标志，**不调 newSession**（inMemory 构造函数已调，实例已有 sessionId）
- **AND** 后续 patched `_persist` 首次调用时 SHALL lazy create：在 DB 的 session 表插入记录（id / cwd / created_at）+ 在 entry 表插入 session header（type="session"，sort_order=0）
- **AND** `sessionFile` SHALL 被设为 `sqlite://<sessionId>` 合成标识（由 patched newSession 设置，不写 DB）
- **AND** 后续每条 entry 通过 patched `_persist` 写入 DB 的 entry 表

#### Scenario: 成员会话持久化（与 leader 同构）

- **WHEN** `TeamManager.createMember` 创建新成员
- **THEN** SHALL 使用 patched `SessionManager.create(cwd)` 创建持久化成员会话（与 leader 相同的 API，调用点不变）
- **AND** 成员 entry SHALL 写入同一 DB 的 entry 表
- **AND** `MemberState.sessionFile` SHALL 记录成员的 `sqlite://<sessionId>` 合成标识
- **AND** TEAM.md members 表 SHALL 通过 Session 列记录该 `sqlite://<sessionId>` 标识

#### Scenario: 运行时追加写盘

- **WHEN** 用户或成员发送消息触发 Agent 循环
- **THEN** patched `_persist` SHALL 检测 `__sqliteStore` 标志，通过 `SessionStore.insertEntry(sessionId, sortOrder, entry)` 把每条 entry 插入 DB 的 entry 表
- **AND** `sort_order` SHALL 为 `fileEntries.length - 1`（entry 已被 `_appendEntry` push 到末尾，O(1) 计算）

#### Scenario: 会话恢复对称性

- **WHEN** 系统恢复已有会话
- **THEN** leader SHALL 使用 patched `SessionManager.open(sessionFile)` 恢复（SDK 静态方法已被 patch）
- **AND** 成员 SHALL 使用 patched `SessionManager.open(sessionFile)` 恢复（与 leader 的恢复路径完全对称）
- **AND** patched `open` SHALL 内部调 `SessionManager.inMemory()` + 挂 `__sqliteStore` + 触发 patched `setSessionFile` 从 DB 加载 entries 重建内存索引
- **AND** 两者的恢复方式 SHALL 遵循相同的 patched `SessionManager` API

#### Scenario: 压缩后全量重写

- **WHEN** Agent 循环触发上下文压缩（compaction）
- **THEN** patched `_rewriteFile` SHALL 检测 `__sqliteStore` 标志，通过 `SessionStore.rewriteAll(sessionId, entries)` 在单事务内 DELETE 该 session 的全部 entry + INSERT 压缩后的 entries
- **AND** 事务 SHALL 保证原子性（压缩失败时 DB 数据无损）

#### Scenario: 不污染 pi 目录

- **WHEN** 系统创建或写入会话
- **THEN** SHALL NOT 在 `~/.pi/` 下创建任何文件或目录
- **AND** SHALL NOT 在 `~/.config/openagent/sessions/` 下创建新的 .jsonl 文件（存储后端已迁移到 sessions.db）
- **AND** 即使 SDK runtime 内部调用 `SessionManager.create`（如 `/new`/`/fork` 命令），patched 静态方法 SHALL 确保走 SQLite 而非默认 `~/.pi/` 目录

### Requirement: 进程重启后恢复会话

系统 SHALL 在启动时根据恢复意图（continue / resume / session / new）构造对应的 patched `SessionManager`（通过 patched 静态工厂 `create` / `open` / `continueRecent`），由 `createAgentSession` 内建逻辑自动检测并恢复历史 messages / model / thinkingLevel。`installSqliteBackend()` SHALL 在 `createRuntime` 入口最先调用，早于任何 `SessionManager.create/open`，确保 SDK 内部 runtime（`agent-session-runtime.js` 的 `newSession`/`fork`/`importFromJsonl`/`switchSession`）调用 patched 静态方法。

#### Scenario: 恢复最近会话

- **WHEN** 用户运行 `openagent --continue`
- **THEN** 系统 SHALL 调用 patched `SessionManager.continueRecent(cwd)`
- **AND** patched `continueRecent` SHALL 通过 `SessionStore.findRecent(cwd)` 查 DB（按 cwd + created_at DESC）找到最近 session id
- **AND** 找到则调 patched `SessionManager.open` 加载，由 SDK 恢复历史 messages 注入 Agent，并恢复 model / thinkingLevel
- **AND** 未找到则退化调 patched `SessionManager.create(cwd)` 新建

#### Scenario: 按会话 id 恢复

- **WHEN** 用户运行 `openagent --session <id>` 或 TUI 内执行 `/resume <id>`
- **THEN** 系统 SHALL 调用 patched `SessionManager.open(<id>)` 加载指定会话
- **AND** patched `setSessionFile` SHALL 从 DB 的 entry 表按 sort_order 加载全部 entries，调 SDK 原生 `_buildIndex()` 重建全部 4 个内存索引（byId / leafId / labelsById / labelTimestampsById）
- **AND** TUI 内触发时（`/resume`）走运行时热切换（`runtime.switchSession`，不重启进程，详见 agent-session 规格）

#### Scenario: 无可恢复会话时降级为新建

- **WHEN** 用户运行 `openagent --continue` 但当前 cwd 在 DB 中无任何历史 session
- **THEN** patched `SessionManager.continueRecent` SHALL 返回 patched `SessionManager.create` 的结果（等价于新建持久化会话），不报错

#### Scenario: 恢复时模型不可用降级

- **WHEN** 恢复的会话原 model 在当前环境不可用
- **THEN** SDK SHALL 返回 `modelFallbackMessage`，系统 SHALL 在 TUI 显示该降级提示并回退到可用模型

### Requirement: 多会话列表

系统 SHALL 能列出当前 cwd 的所有持久化会话（数据来源为 SQLite DB 的 session 表 + entry 表聚合），展示序号、相对时间、首条消息预览与消息数，供用户选择恢复。列表查询 SHALL 通过 patched `SessionManager.list(cwd)` 或直接 `SessionStore.listSessions(cwd)` 用 SQL 索引化查询完成（O(sessions) 而非 O(总 entries) 的全盘扫描）。

#### Scenario: 列出当前 cwd 会话

- **WHEN** 用户执行 `/sessions`
- **THEN** 系统 SHALL 调用 patched `SessionManager.list(cwd)` → `SessionStore.listSessions(cwd)` 查 DB
- **AND** 查询 SHALL 用 `idx_session_cwd_created` 索引按 created_at DESC 排序
- **AND** 渲染列表，每项含：序号、相对时间（session.created_at）、首条消息预览（entry 表中该 session 的第一条 type=message 的 data.message）、消息数（entry 表中该 session 的 type=message 行数）、会话名（若有，session.name）

#### Scenario: 空列表提示

- **WHEN** 用户执行 `/sessions` 但当前 cwd 在 DB 中无任何 session 记录
- **THEN** 系统 SHALL 显示「当前目录暂无会话」提示

#### Scenario: 列表数据支持热切换

- **WHEN** 用户在 `/sessions` 列表选择某项（或执行 `/resume <序号|id>`）
- **THEN** 系统 SHALL 用该项的 sessionId 调用 patched `SessionManager.open` 运行时热切换（不重启进程，详见 agent-session 规格）

### Requirement: 会话命名

系统 SHALL 支持给会话命名，名称通过 `SessionStore.setSessionName(id, name)` 持久化到 DB 的 session 表 name 列，并在 `/sessions` 列表中优先显示。

#### Scenario: 命名当前会话

- **WHEN** 用户执行 `/name <text>`
- **THEN** 系统 SHALL 调用 `SessionStore.setSessionName(sessionId, text)` 把名称写入 DB 的 session.name 列

#### Scenario: 列表优先显示名称

- **WHEN** 渲染 `/sessions` 列表且某会话已命名（session.name 非空）
- **THEN** 该项 SHALL 优先显示 session.name，未命名的会话显示首条消息预览

## ADDED Requirements

### Requirement: 首次启动自动迁移 JSONL 到 SQLite

系统 SHALL 在 `installSqliteBackend()` 执行时检测是否需要迁移：DB 的 session 表为空 **且** `~/.config/openagent/sessions/` 目录下存在 .jsonl 文件 → 触发一次性迁移 `migrateIfNeeded()`。迁移 SHALL 在单事务内完成，任一 .jsonl 文件解析失败 → ROLLBACK 整个事务，原 .jsonl 数据无损。迁移成功后 SHALL 把 `sessions/` 目录改名为 `sessions.bak/` 保留原始数据；若 `sessions.bak/` 已存在则报错（避免覆盖用户已手动备份的数据）。迁移 SHALL 幂等（DB 已有数据则跳过，支持多次启动不重复迁移）。

#### Scenario: 首次启动触发迁移

- **WHEN** 系统首次启动且 DB session 表为空且 `~/.config/openagent/sessions/` 存在 .jsonl 文件
- **THEN** SHALL 在单事务内遍历 sessions/ 下所有子目录（按 cwd-hash 分）及所有 .jsonl 文件
- **AND** 逐文件用 SDK `loadEntriesFromFile` 解析为 FileEntry[]（含 session header）
- **AND** 通过 `SessionStore.bulkImport` 写入 DB 的 session + entry 表（header 作为 sort_order=0 的 entry）
- **AND** 全部成功后提交事务
- **AND** 提交后把 `sessions/` 改名为 `sessions.bak/`

#### Scenario: 迁移失败回滚不损坏原数据

- **WHEN** 迁移过程中某个 .jsonl 文件解析或写入失败
- **THEN** SHALL ROLLBACK 事务（DB 不留任何该次迁移的数据）
- **AND** SHALL NOT 改名 `sessions/` 目录（原 .jsonl 文件无损）
- **AND** SHALL 抛出错误（含失败的文件路径）供用户排查

#### Scenario: sessions.bak 已存在则报错

- **WHEN** 迁移成功准备改名，但 `sessions.bak/` 已存在
- **THEN** SHALL 报错（避免覆盖用户已手动备份的数据）
- **AND** SHALL NOT 改名 `sessions/` 目录
- **AND** DB 数据已提交（用户可手动处理 sessions/ 后重新启动）

#### Scenario: 已迁移的 DB 不重复迁移

- **WHEN** 系统启动且 DB session 表已有数据
- **THEN** SHALL 跳过迁移（即使 `sessions.bak/` 或 `sessions/` 仍存在 .jsonl 文件）

#### Scenario: 全新环境无历史数据不迁移

- **WHEN** 系统首次启动且 DB session 表为空且 `~/.config/openagent/sessions/` 不存在或无 .jsonl 文件
- **THEN** SHALL NOT 触发迁移，直接走正常新建会话路径

### Requirement: Team 目录迁移到独立顶层

系统 SHALL 在 JSONL→SQLite 迁移成功后，把旧的 team 目录（`~/.config/openagent/sessions/<cwd-hash>/team/<sessionId>/`）迁移到新的独立顶层路径 `~/.config/openagent/team/<sessionId>/`。因为迁移后 `sessions/` 改名 `sessions.bak/`，旧 team 目录路径失效。新 team 目录路径 SHALL 通过 paths 模块的 `teamDirForSession(sessionId)` 统一引用。`sessionTeamDir()`（src/server/index.ts）SHALL 改用 `parseSessionIdFromUri(sessionFile)` + `teamDirForSession(sessionId)` 构造路径。

#### Scenario: 迁移时搬运 team 目录

- **WHEN** JSONL→SQLite 迁移成功后，旧 `sessions/<cwd-hash>/team/` 下存在 `<sessionId>/` 子目录
- **THEN** SHALL 把每个 `<sessionId>/` 子目录搬到新 `~/.config/openagent/team/<sessionId>/`
- **AND** member memory（members/<name>/）、member index（members/<name>.md）、TEAM.md SHALL 完整保留

#### Scenario: sessionTeamDir 用新路径

- **WHEN** `src/server/index.ts` 的 `sessionTeamDir()` 构造 team 目录路径
- **THEN** SHALL 用 `parseSessionIdFromUri(this.session.sessionFile)` 提取 sessionId
- **AND** SHALL 用 `teamDirForSession(sessionId)` 拼新路径 `~/.config/openagent/team/<sessionId>/`
- **AND** SHALL NOT 使用旧的 `dirname(sessionFile)` + `basename().replace(/\.jsonl$/,"")` 逻辑
