# Design: session-sqlite-storage

## 架构总览

```
┌──────────────────────────────────────────────────────────────────┐
│  应用启动（src/agent/session.ts createRuntime）                    │
│  await installSqliteBackend() 一次性 patch SessionManager 类       │
│  （内部：assertSdkStructure + migrateIfNeeded + patch 类）         │
└──────────────────────────┬───────────────────────────────────────┘
                           │ install 完成后，getOrCreateStore() 同步可用
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│  Patched SessionManager 类（prototype + static methods）          │
│                                                                   │
│  Static（全部同步，匹配 SDK 契约；list/listAll 保持 async）       │
│  create(cwd) / open(sessionFile) / continueRecent(cwd)            │
│  → inMemory(cwd) 创建实例 + 挂 __sqliteStore                       │
│  → 不调 newSession（inMemory 构造函数已调，实例已有 sessionId）    │
│                                                                   │
│  Prototype（所有实例自动生效，检查 __sqliteStore 决定走 SQLite）   │
│  • newSession → 只设 sessionFile=sqlite://<id>，不写 DB            │
│  • _persist → lazy create session 记录+header，再 insertEntry     │
│  • _rewriteFile → lazy create，再 rewriteAll 全量                 │
│  • setSessionFile → 从 DB 加载 + _buildIndex + 版本迁移检查        │
│  • createBranchedSession → 保存 parent + patch header + DB 分支   │
│  • isPersisted → 返回 true                                        │
│                                                                   │
│  复用 SDK 内存逻辑（不打补丁）                                     │
│  • fileEntries/byId/leafId 内存索引                               │
│  • 树遍历/压缩 compaction/分支算法（1200 行原生）                  │
│  • _appendEntry/_buildIndex/appendMessage 等                      │
└──────────────────────────────────────────────────────────────────┘
           │                                       │
           │ SDK runtime 内部调用也走 patched 静态方法 │ 委托 CRUD
           │（newSession/fork/import/switch 全覆盖） │
           ▼                                       ▼
  agent-session-runtime.js              SessionStore（新增, 单例）
  5 个 SessionManager.* 调用点           → ~/.config/openagent/sessions.db
```

## 关键决策

### Decision 1: Class-level Monkey-Patch + Lazy Create

**选择**：应用启动时 `installSqliteBackend()` 一次性 patch `SessionManager.prototype`（6 个实例方法）+ `SessionManager` 静态方法（create/open/continueRecent 同步；list/listAll async）。SQLite 模式实例通过 `__sqliteStore` 标志区分。**DB 写入采用 lazy create 策略**：patched newSession 不写 DB（只设 sessionFile），首次 `_persist`/`_rewriteFile` 调用时才创建 session 记录 + 写 header。

**理由**（Oracle R1 P0 + R2 P0 修正）：
- **类级 patch（非实例 wrapper）**：SDK `AgentSessionRuntime`（agent-session-runtime.js）在 `/new`/`/fork`/`/clone`/`/import`/`/resume` 直接调 `SessionManager.create/open` 静态方法（5 个调用点），必须 patch 类才能覆盖。
- **静态方法同步**：SDK `create`/`open`/`continueRecent` 全部同步（session-manager.js:1080/1090/1105 `return new SessionManager(...)`），agent-session-runtime.js:151-153/201/213 无 await。patched 版必须保持同步。
- **Lazy create**：`SessionManager.inMemory(cwd)` 构造函数已自动调 `newSession`（构造函数 sessionFile=undefined 分支 → newSession），SDK runtime 的 fork/newSession 路径可能再次调用。若 patched newSession 立即写 DB，多次调用产生孤儿 session 记录。Lazy create 确保只有"最后一次 newSession + 后续 _persist"的 sessionId 进 DB。

**替代方案（已否决）**：
- ~~Wrap 单个 inMemory 实例~~：覆盖不了 SDK runtime（R1 P0）
- ~~patched create 调 newSession 写 DB~~：多次调用产生孤儿（R2 P0-新#2）
- ~~patched newSession 立即写 DB~~：同上
- ~~Fork SDK~~：维护成本高

### Decision 2: SDK Runtime 路径覆盖

patch 类后，agent-session-runtime.js 的 5 个调用点全部走 patched 版本：

| 调用点 | 行号 | patch 后行为 |
|---|---|---|
| `switchSession` | :131 `SessionManager.open(sessionPath)` | patched open 从 DB 加载 |
| `newSession` | :152 `SessionManager.create(cwd, sessionDir)` | patched create（同步，不调 newSession）|
| `fork`（无 targetLeaf） | :201 `SessionManager.create` + :202 `newSession({parent})` | patched create + patched newSession（SDK 显式调 newSession 传 parentSession，patched 只设 sessionFile 不写 DB，后续 _persist lazy create）|
| `fork`（有 targetLeaf） | :213 `SessionManager.open(currentSessionFile)` + `createBranchedSession` | patched open 从 DB 加载 + patched createBranchedSession 在 DB 创建分支 |
| `importFromJsonl` | :270 `SessionManager.open(destinationPath)` | patched open 检测真实 .jsonl → importJsonlToDb 导入 DB |

### Decision 3: SQLite Schema

```sql
CREATE TABLE session (
  id          TEXT PRIMARY KEY,
  cwd         TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  parent_session TEXT,
  name        TEXT
);
CREATE TABLE entry (
  id          TEXT NOT NULL,
  session_id  TEXT NOT NULL REFERENCES session(id),
  sort_order  INTEGER NOT NULL,
  type        TEXT NOT NULL,
  parent_id   TEXT,
  timestamp   TEXT NOT NULL,
  data        TEXT NOT NULL,
  PRIMARY KEY (session_id, sort_order)
);
CREATE INDEX idx_entry_session ON entry(session_id);
CREATE INDEX idx_session_cwd ON session(cwd);
CREATE INDEX idx_session_cwd_created ON session(cwd, created_at DESC);
```
- `entry.data` 存完整 JSON blob（FileEntry 联合类型）
- `sort_order` 保插入顺序（rewriteAll 用数组 index 0..n-1）
- WAL 模式提升并发与崩溃恢复
- SessionStore 单例共享 Database 实例（避免多连接 SQLITE_BUSY）

### Decision 4: sessionFile = `sqlite://<sessionId>`

SQLite 模式实例的 `sessionFile` 值为 `sqlite://<sessionId>`。影响点：
- `src/teams/manager-v2.ts:222-224/344-346`：`basename().replace(/\.jsonl$/,"")` → `parseSessionIdFromUri()`
- `src/server/index.ts:137-144 sessionTeamDir()`：改用 `parseSessionIdFromUri` + 新 team 路径
- SDK `formatResumeCommand`（`fs.existsSync("sqlite://...")` 恒 false）：接受此行为（TUI 自行显示 session id），或在 installSqliteBackend 时 patch

### Decision 5: 迁移流程（含 Team 目录，时序明确）

```
installSqliteBackend() 执行时检测：DB session 表为空 且 sessions/ 存在 .jsonl
1. 开启 SQLite 事务
2. 遍历 sessions/<cwd-hash>/*.jsonl → loadEntriesFromFile → bulkImport（含 header）
   ※ bulkImport 导入前对每个文件调 migrateToCurrentVersion，保证 DB 只存当前版本
3. 提交事务（失败 → ROLLBACK，原数据无损）
4. 【改名前】搬运 team 目录：sessions/<cwd-hash>/team/<sessionId>/ → ~/.config/openagent/team/<sessionId>/
   ※ 每个子目录独立幂等检测：目标已存在则跳过该子目录（避免半搬状态无法重试）
5. 检测 sessions.bak 是否已存在：
   - 已存在 → 报错（不覆盖），sessions/ 保留
   - 不存在 → sessions/ 改名 sessions.bak/
```
**时序关键**：team 搬运（步骤4）在改名（步骤5）之前，此时 sessions/ 还在原位。幂等：DB 已有数据则跳过整个流程。

### Decision 6: Team 目录新路径

新路径：`~/.config/openagent/team/<sessionId>/`（脱离 sessions 目录）。`sessionTeamDir()` 改用 `parseSessionIdFromUri(sessionFile)` + `teamDirForSession(sessionId)`。

### Decision 7: importJsonlToDb 语义 + 校验函数废弃

- **importJsonlToDb(store, jsonlPath, cwdOverride?)**：loadEntriesFromFile 解析 → 提取 sessionId（从 header）+ cwd → bulkImport 到 DB。导入后**不删除原 .jsonl**（SDK importFromJsonl 场景下 destinationPath 是 SDK 管理的，留给 SDK 清理）。无 header 的异常文件抛错。幂等：同一 sessionId 重复导入时 INSERT OR REPLACE。
- **validateMemberSessionPath**：废弃（不再有 .jsonl 路径）。改用 `validateSessionId(id)`。
- **resolveMemberSessionPath**：废弃。`SessionManager.open` 直接接收 sessionId。

## Patch 实现细节

### 辅助函数

```typescript
// src/session/sdk-internals.ts
interface SdkInternals {
  sessionId: string; sessionFile: string | undefined; sessionDir: string;
  cwd: string; persist: boolean; flushed: boolean;
  fileEntries: FileEntry[]; byId: Map<string, SessionEntry>; leafId: string | null;
}
export function getSdkInternals(inst: SessionManager): SdkInternals {
  return inst as unknown as SdkInternals;  // 集中 private 访问
}
export function getSqliteStore(inst: SessionManager): SessionStore | undefined {
  return (inst as any).__sqliteStore;
}
export function setSqliteStore(inst: SessionManager, store: SessionStore): void {
  (inst as any).__sqliteStore = store;
}

// lazy create：首次写入时创建 session 记录 + header entry
function ensureSessionRecord(store: SessionStore, internals: SdkInternals): void {
  const sid = internals.sessionId;
  if (store.hasSession(sid)) return;  // 已创建，跳过
  const header = internals.fileEntries.find((e) => e.type === "session");
  store.createSession(sid, internals.cwd, header?.parentSession);
  if (header) store.insertEntry(sid, 0, header);  // header 占 sort_order=0
}
```

### patched `_persist(entry)` — lazy create + 单条插入

```typescript
const originalPersist = SessionManager.prototype._persist;
SessionManager.prototype._persist = function(entry: SessionEntry): void {
  const store = getSqliteStore(this);
  if (!store) return originalPersist.call(this, entry);  // 非 SQLite 走原逻辑
  const internals = getSdkInternals(this);
  ensureSessionRecord(store, internals);  // lazy: 首次调用创建 session 记录 + header
  const sortOrder = internals.fileEntries.length - 1;  // entry 已被 _appendEntry push 到末尾
  store.insertEntry(internals.sessionId, sortOrder, entry);
};
```
**语义说明**：SQLite 模式采用立即落盘（每条 entry 即时 insert），放弃 SDK 的延迟 flush 语义（SDK 原 _persist 在无 assistant 消息时延迟）。这是改进（更不易丢数据），SDK 的 `flushed` 标志在 SQLite 模式下不参与持久化决策。

### patched `_rewriteFile()` — lazy create + 全量重写

```typescript
const originalRewrite = SessionManager.prototype._rewriteFile;
SessionManager.prototype._rewriteFile = function(): void {
  const store = getSqliteStore(this);
  if (!store) return originalRewrite.call(this);
  const internals = getSdkInternals(this);
  ensureSessionRecord(store, internals);  // lazy（compaction 前若从未 _persist 过）
  store.rewriteAll(internals.sessionId, internals.fileEntries);  // 事务内 DELETE+INSERT ALL
};
```
**rewriteAll 的 sort_order**：用数组 index（0..n-1）。compaction 后 fileEntries 被替换为压缩后数组（长度 n），rewriteAll 写 0..n-1，下一次 _persist 的 sortOrder = n。**对齐正确**。

### patched `setSessionFile(sessionFile)` — 从 DB 加载 + 版本迁移

```typescript
const originalSetSessionFile = SessionManager.prototype.setSessionFile;
SessionManager.prototype.setSessionFile = function(sessionFile: string): void {
  const store = getSqliteStore(this);
  if (!store || !sessionFile) return originalSetSessionFile.call(this, sessionFile);  // R3 P2 防御 undefined
  const internals = getSdkInternals(this);
  const sessionId = parseSessionIdFromUri(sessionFile);
  const entries = store.loadEntries(sessionId);  // 按 sort_order 排序
  if (entries.length === 0) {
    throw new Error(`SQLite session ${sessionId} has no entries (DB corrupted?)`);
  }
  internals.sessionFile = sessionFile;
  internals.fileEntries = entries;
  internals.sessionId = sessionId;
  internals.flushed = true;
  // 版本迁移：DB 导入时已 migrateToCurrentVersion（Decision 5），此处无需再迁
  // 复用 SDK 原生 _buildIndex 重建全部 4 个索引
  (this as any)._buildIndex();
};
```
**版本迁移约定**：bulkImport（Decision 5 步骤2）导入前对每个文件调 `migrateToCurrentVersion`，保证 DB 只存当前版本。setSessionFile 加载后无需再迁。

### patched `newSession(options?)` — 只设 sessionFile，不写 DB

```typescript
const originalNewSession = SessionManager.prototype.newSession;
SessionManager.prototype.newSession = function(options?): string | undefined {
  const store = getSqliteStore(this);
  if (!store) return originalNewSession.call(this, options);  // 非 SQLite 走原逻辑
  // 调原始逻辑：生成 sessionId、重置 fileEntries=[header]、清索引
  originalNewSession.call(this, options);
  // 只设 sessionFile 合成标识，不写 DB（lazy create 延迟到 _persist/_rewriteFile）
  const internals = getSdkInternals(this);
  const uri = `sqlite://${internals.sessionId}`;
  internals.sessionFile = uri;
  // R3 P1 修正：SDK newSession 在 persist=false 时可能不设 header.parentSession（与 createBranchedSession 同门控），需 patch
  if (options?.parentSession) {
    const header = internals.fileEntries.find((e) => e.type === "session");
    if (header) header.parentSession = options.parentSession;
  }
  return uri;
};
```
**关键（R2 P0-新#2 修正）**：不写 DB。`SessionManager.inMemory()` 构造函数已调一次 newSession（但此时 __sqliteStore 未挂，走原版 no-op）；SDK runtime 可能再调 newSession（fork/newSession with parentSession）。无论调几次，只有"最后一次 + 后续 _persist"的 sessionId 会通过 lazy create 进 DB，无孤儿。

### patched `createBranchedSession(leafId)` — 保存 parent + patch header + DB 分支

```typescript
const originalCreateBranched = SessionManager.prototype.createBranchedSession;
SessionManager.prototype.createBranchedSession = function(leafId): string | undefined {
  const store = getSqliteStore(this);
  if (!store) return originalCreateBranched.call(this, leafId);
  const parentSessionId = getSdkInternals(this).sessionId;  // 先保存原 sessionId
  originalCreateBranched.call(this, leafId);  // SDK in-memory 分支：替换 fileEntries/sessionId
  const internals = getSdkInternals(this);
  const newSessionId = internals.sessionId;
  const uri = `sqlite://${newSessionId}`;
  internals.sessionFile = uri;
  // R2 P1-新#5 修正：SDK in-memory 分支构造的 header.parentSession=undefined，需 patch
  const header = internals.fileEntries.find((e) => e.type === "session");
  if (header) header.parentSession = parentSessionId;
  // DB 创建分支 session 记录 + 全量写入（含 header，sort_order 用数组 index）
  store.createSession(newSessionId, internals.cwd, parentSessionId);
  store.rewriteAll(newSessionId, internals.fileEntries);
  return uri;
};
```

### patched `isPersisted()` — 返回 true

```typescript
SessionManager.prototype.isPersisted = function(): boolean {
  if (getSqliteStore(this)) return true;
  return getSdkInternals(this).persist;
};
```
**必要性**：agent-session-runtime.js:151/194 检查 isPersisted() 决定走 create 还是 inMemory。返回 true 确保走 patched create（SQLite 工厂）。

### patched 静态 `create(cwd, sessionDir?)` — 同步，不调 newSession

```typescript
const originalCreate = SessionManager.create;
SessionManager.create = function(cwd: string, _sessionDir?: string): SessionManager {
  const store = getOrCreateStore();  // 同步（installSqliteBackend 完成后已初始化）
  const inst = SessionManager.inMemory(cwd);  // 构造函数已调 newSession（生成 sessionId）
  setSqliteStore(inst, store);  // 挂标志
  // 不调 inst.newSession()（R2 P0-新#2）：实例已有 sessionId，DB 延迟到 _persist lazy create
  return inst;
};
```
**同步签名（R2 P0-新#1 修正）**：SDK create 同步，agent-session-runtime.js:152/201 无 await。patched 必须同步。

### patched 静态 `open(sessionFile, sessionDir?, cwdOverride?)` — 同步

```typescript
const originalOpen = SessionManager.open;
SessionManager.open = function(sessionFile: string, _sessionDir?: string, cwdOverride?: string): SessionManager {
  const store = getOrCreateStore();
  let sessionId: string;
  let cwd: string;
  if (sessionFile.startsWith("sqlite://")) {
    sessionId = parseSessionIdFromUri(sessionFile);
    const sess = store.getSession(sessionId);
    if (!sess) throw new Error(`SQLite session not found: ${sessionId}`);
    cwd = cwdOverride ?? sess.cwd;
  } else {
    // 真实 .jsonl 路径（importFromJsonl 场景）
    sessionId = importJsonlToDb(store, sessionFile, cwdOverride);
    cwd = cwdOverride ?? store.getSession(sessionId)!.cwd;
  }
  const inst = SessionManager.inMemory(cwd);
  setSqliteStore(inst, store);
  inst.setSessionFile(`sqlite://${sessionId}`);  // 触发 patched setSessionFile 从 DB 加载
  return inst;
};
```

### patched 静态 `continueRecent(cwd, sessionDir?)` — 同步

```typescript
SessionManager.continueRecent = function(cwd: string, _sessionDir?: string): SessionManager {
  const store = getOrCreateStore();
  const recent = store.findRecent(cwd);
  if (!recent) return SessionManager.create(cwd);  // 无历史则新建（走 patched create）
  return SessionManager.open(`sqlite://${recent.id}`, undefined, cwd);
};
```

### patched 静态 `list(cwd)` / `listAll()` — async（SDK 原版 async）

```typescript
SessionManager.list = async function(cwd: string, _sessionDir?: string): Promise<SessionInfo[]> {
  const store = getOrCreateStore();
  return store.listSessions(cwd);
};
// listAll 同理
```

### installSqliteBackend() 入口

```typescript
// src/session/install-sqlite-backend.ts
let store: SessionStore | undefined;  // 单例
let installed = false;

export function getOrCreateStore(): SessionStore {
  if (!store) throw new Error("installSqliteBackend() not yet called");
  return store;  // 同步返回已初始化的 store
}

export async function installSqliteBackend(): Promise<void> {
  if (installed) return;
  installed = true;
  assertSdkStructure(SessionManager);  // 结构断言
  store = new SessionStore(sessionsDbPath());  // 初始化单例
  await migrateIfNeeded(store);  // 首次迁移（含 team 目录搬运）
  patchPrototype(SessionManager.prototype);  // patch 6 个实例方法
  patchStatic(SessionManager);  // patch 静态方法
}
```
**时序约定**：`createRuntime`（src/agent/session.ts）入口最先 `await installSqliteBackend()`，完成后所有 patched 方法可达，`getOrCreateStore()` 同步返回。

## 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| SDK private 字段改名 | patched 方法崩溃 | pin 版本 + assertSdkStructure + getSdkInternals 集中访问 + 升级回归测试（create/open/continueRecent/new/branch/compact） |
| 迁移失败损坏数据 | 用户丢会话 | 单事务 + ROLLBACK + sessions.bak 改名双保险 + sessions.bak 已存在则报错 |
| DB 损坏 | 全部会话不可读 | WAL 模式 + sessions.bak JSONL 兜底 + SessionStore 单例共享 Database |
| Team 目录迁移遗漏 | member 数据丢失 | 迁移流程步骤4 改名前搬运（Decision 5） |
| lazy create 的 header 识别 | header 须在 fileEntries 里 | ensureSessionRecord 用 `fileEntries.find(type==="session")`，newSession 后 fileEntries=[header] 保证存在 |
| newSession 多次调用 | 前几次的 sessionId 不进 DB | patched newSession 不写 DB（只设 sessionFile），无孤儿 |
| SDK 升级新增静态方法 | 未 patch 创建 JSONL 实例 | assertSdkStructure 检查静态方法清单 |

## 验证策略

1. **单元测试**：paths / sqlite-store / sdk-internals / install-sqlite-backend / migrate
2. **bun run check**：typecheck + lint + test 全绿
3. **迁移验证**：构造含 session + team 目录的 sessions/ → 迁移 → 验证 DB 完整 + team 搬到新位置 + sessions.bak 存在
4. **SDK runtime 路径验证**（R1 P0 重点）：
   - `/new` → patched create（同步），新 session 经 lazy create 进 DB，**不写 ~/.pi/**
   - `/fork`（无 targetLeaf）→ patched create + SDK newSession({parent}) + 后续 _persist lazy create，无孤儿
   - `/fork`（有 targetLeaf）→ patched open + createBranchedSession，分支在 DB，header.parentSession 正确
   - `/resume` → patched open 从 DB 加载
   - **`/import`** → patched open 检测真实 .jsonl → importJsonlToDb 导入 DB 再加载
5. **lazy create 验证**：newSession 被调多次（模拟 fork 路径）→ 验证 DB 只有最后一次 sessionId 的记录，无孤儿
6. **team 验证**：createMember + restoreMembers + 切换 session 后 member 恢复
