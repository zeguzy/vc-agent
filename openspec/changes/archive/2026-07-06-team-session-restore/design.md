## Context

Team 模式当前在 session 切换时完全丢失运行时状态：

```
/session 切换
    │
    ▼
server/index.ts: setRebindSession callback
    │
    ├─ cancelOrphans=true ──▶ disposeTeam() + new TeamManager(teamDir)
    │                              │                    │
    │                              │                    └─ members Map = 空
    │                              │                       files.initTeamDir() 只创建不读
    │                              └─ 旧 members 全部 dispose
    │                                 session.inMemory() → 对话历史永久丢失
    │
    └─ cancelOrphans=false ──▶ 旧 TeamManager 保留（但 session 已换，teamDir 可能变了）
```

**根因**：成员和 leader 使用了两套不同的上下文管理机制。Leader 用 `SessionManager.create/open/continueRecent`（JSONL 持久化），成员用 `SessionManager.inMemory()`（无持久化）。这是架构上的不一致——成员和 leader 本质上是同构的 AgentSession，应该复用同一套上下文管理。

## Goals / Non-Goals

**Goals:**
- 成员和 leader 使用相同的上下文管理方式（持久化 SessionManager）
- TEAM.md 只持有成员的 session 引用（sessionFile 路径），不存储 session 数据本身
- `/session` 切换后，成员列表在 UI 上正确显示
- 成员对话上下文可恢复（通过 `SessionManager.open` 或 `continueRecent`，与 leader 恢复方式完全对称）
- 恢复后的成员可继续接受任务分配，行为与新建成员一致

**Non-Goals:**
- Git worktree 隔离实现
- 跨进程成员状态恢复
- 成员对话历史的 UI 浏览/回放
- V1 Worker 持久化改造
- 成员 session 文件的清理/过期策略（后续优化）

## Decisions

### D1: 成员与 leader 同构 — 复用 SessionManager 持久化

**选择**：成员 session 使用与 leader 完全相同的 `SessionManager` API，存放在标准 sessions 目录下

**核心原则**：成员 = 同构 session，team 配置只持有引用

```
Leader Session                         Member Session
┌──────────────────┐                   ┌──────────────────┐
│ SessionManager   │                   │ SessionManager   │
│ .create/open/    │                   │ .create/open/    │  ← 同样的 API
│ continueRecent   │                   │ continueRecent   │  ← 同样的 API
│ → JSONL 持久化   │                   │ → JSONL 持久化   │  ← 同样的持久化
│ → sessionFile    │                   │ → sessionFile    │  ← 同样的引用方式
└──────────────────┘                   └──────────────────┘
        │                                      │
        │  team config holds:                   │
        │  memberSessionFile path               │
        └───────────────────────────────────────┘
```

**替代方案**：
- ❌ 成员 session 放在 teamDir 下的 sessions/ 子目录 → 破坏了与 leader session 的对称性，且 teamDir 本身不是 session 存储根目录
- ❌ dispose 前序列化 `session.messages` → 需自建 replay 逻辑，复杂度高
- ❌ 从磁盘文件部分重建（profile+memory） → 有损恢复，对话上下文不可用

**成员 session 存储路径**：

成员 session 存放在标准 sessions 目录下，和 leader session 并列：

```
~/.config/openagent/sessions/
├── 2026-07-06T10-30-00.jsonl         ← leader session
├── team/                             ← team 成员 sessions
│   ├── alice-2026-07-06T10-31-00.jsonl   ← 成员 alice
│   └── bob-2026-07-06T10-32-00.jsonl     ← 成员 bob
```

或者更简洁：成员直接用 `SessionManager.create(cwd, sessionDir)` 创建在标准 sessionDir 下，让 SDK 管理 JSONL 文件。TEAM.md 的 members 表增加 `Session` 列存储 sessionFile 路径。

### D2: TEAM.md members 表增加 Session 列 — 存储 session ID 而非绝对路径

**选择**：members 表新增 `Session` 列，存储成员的 **session ID**（JSONL 文件名，不含目录前缀），restore 时解析为绝对路径

**当前格式**：
```
| Name | Role | Status | Current Task |
|------|------|--------|--------------|
| alice | coder | idle | - |
```

**新格式**：
```
| Name | Role | Status | Current Task | Session |
|------|------|--------|--------------|---------|
| alice | coder | idle | - | 2026-07-06T10-31-00 |
```

**为什么存 session ID 而非绝对路径**（Oracle 审查意见）：
- ❌ 存绝对路径（如 `/Users/x/.config/openagent/sessions/abc.jsonl`）→ 用户搬家/重装后引用失效
- ❌ 绝对路径是路径遍历攻击面 — 恶意编辑 TEAM.md 可指向任意文件
- ✅ 存 session ID（文件名 stem）→ restore 时 `join(sessionDirRoot(), sessionId + ".jsonl")` 解析，可验证路径合法性
- ✅ 与 leader 的 sessionFile 机制对等 — leader 也是通过 sessionDir + 文件名管理

**路径验证**（安全必须）：restore 时解析 session ID 为绝对路径后，必须验证：
1. 解析后的路径在 `sessionDirRoot()` 下（`startsWith` 检查）
2. 文件名匹配合法 pattern（`^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}` 或 UUID 格式）
3. 扩展名为 `.jsonl`

**理由**：
- session ID 是恢复成员 session 的唯一凭证，且不依赖绝对路径
- 与 leader 的 `session.sessionFile` 机制对等（leader 也存文件名，通过 sessionDir 解析）
- restore 时 `SessionManager.open(resolvedPath, sessionDir)` 恢复

### D3: restoreMembers() 实现策略

**选择**：在 `TeamManager` 新增 `restoreMembers()` 方法，从 TEAM.md 读取成员列表+session 引用，逐个恢复

**流程**：

```
restoreMembers()
    │
    ├─ 1. files.readTeamMd() → 解析 members 表（含 Session ID 列）
    │
    ├─ 2. 对每个成员：
    │     ├─ files.readMemberIndex(name) → 取 profile/memoryIndex
    │     ├─ buildMemberSystemPrompt() → 构建 L1+L2+L3
    │     ├─ 解析 session ID → join(sessionDirRoot(), sessionId + ".jsonl")
    │     ├─ 路径验证：在 sessionDirRoot() 下 + 文件名合法 + 扩展名 .jsonl
    │     ├─ 验证通过 → SessionManager.open(resolvedPath, sessionDir)
    │     │   └─ SessionManager.open 失败 → fallback 到 SessionManager.create()
    │     ├─ 验证失败 / 无 Session 列 → SessionManager.create()
    │     ├─ createAgentSession({ ..., sessionManager }) → 恢复 AgentSession
    │     ├─ 从 activeTasks 反向推导 currentTaskId（如有匹配的未完成 task）
    │     └─ 填充 members Map + 订阅事件
    │
    └─ 3. emit("members_restored") → UI 刷新
```

**关键决策**：使用 `SessionManager.open(sessionFile)` 而非 `continueRecent`，因为：
- 成员的 sessionFile 路径已在 TEAM.md 中显式记录
- `open(path)` 是确定性的，不像 `continueRecent` 要猜测最近 session
- 与 leader 的 `buildSessionManager(mode="session")` 路径完全对齐

### D4: setRebindSession 回调修改

**选择**：在 `cancelOrphansOnSessionChange=true` 分支，创建新 TeamManager 后调用 `await teamManager.restoreMembers()`

```diff
 this.runtime.setRebindSession(async (newSession) => {
   if (this.teamConfig.cancelOrphansOnSessionChange) {
     await this.disposeTeam();
     this.teamManager = new TeamManager(
       this.teamConfig,
       this.runtime.services,
       this.cwd,
       this.sessionTeamDir(),
     );
     this.teamRef.current = this.teamManager;
+    await this.teamManager.restoreMembers({
+      services: this.runtime.services,
+      parentModel: this.session.model,
+    });
   }
   this.resubscribe();
   for (const handler of this.sessionChangeHandlers) {
     await handler(newSession);
   }
 });
```

**`cancelOrphansOnSessionChange=false` 分支**：不 dispose 旧 TeamManager，但 `sessionTeamDir()` 可能变了。当前行为是保留旧 TeamManager（成员继续在旧 teamDir 工作），这是合理的——用户显式选择不取消 orphan。不修改此分支。

### D5: dispose() 行为

**选择**：`dispose()` 不删除成员 session 文件，仅 dispose AgentSession + 清空内存 Map

**理由**：session 文件存在标准 sessions 目录下，不由 team 管理。`dispose()` 只清理内存中的 AgentSession 引用。与 leader session 文件不被删除一致。

## Risks / Trade-offs

**[磁盘占用]** → 每个成员新增 JSONL session 文件。缓解：成员 session 与 leader session 同等大小量级，通常可接受。后续可加清理策略。

**[SessionManager.open 失败]** → 如果成员 session 文件损坏或被外部删除，`SessionManager.open()` 可能抛异常。缓解：`restoreMembers()` 中 try-catch 单个成员恢复失败，跳过该成员并 log 警告，不阻塞其他成员恢复。

**[恢复后成员状态不一致]** → TEAM.md 记录成员 status=active，但 session 切换后实际应为 idle（任务已中断）。缓解：`restoreMembers()` 将所有恢复成员的 status 重置为 idle，并更新 TEAM.md。

**[并发恢复]** → 如果 `restoreMembers()` 被并发调用（如快速连续切换 session）。缓解：加 `isRestoring` 标志防止重入，且必须在 `finally` 块中重置以防异常导致永久锁。

**[cancelOrphans=false 时的 teamDir 不匹配]** → 旧 TeamManager 的 teamDir 与新 session 不匹配。缓解：当前行为是合理的（用户显式选择保留 orphan），不修改。

**[路径遍历安全风险]**（Oracle 审查必须修复）→ TEAM.md 是用户可编辑的 markdown 文件，Session 列可能被篡改为 `../../etc/passwd`。缓解：存 session ID 而非绝对路径（D2），restore 时解析为绝对路径后必须验证：(1) 在 `sessionDirRoot()` 下、(2) 文件名匹合法 pattern、(3) 扩展名 `.jsonl`。不合法则视为该成员无有效 session，fallback 到 `SessionManager.create()`。

**[mid-task 恢复的 currentTaskId 缺失]**（Oracle 审查发现）→ 成员正在执行任务时 session 切换，旧 TeamManager dispose 后 `members` Map 中的 `currentTaskId` 丢失。恢复后成员有对话历史但无任务引用。缓解：TEAM.md 的 `activeTasks` 段已有 task 描述（含 `memberName`），`restoreMembers()` 可从 `activeTasks` 反向推导 `currentTaskId`。如果该成员有未完成 task 且 memberName 匹配，则恢复 `currentTaskId`；否则设为 null（idle）。

**[TEAM.md 格式变更兼容性]** → members 表新增 Session 列，旧格式无此列。缓解：`parseMembersTable` 对 Session 列做可选解析（`cells[4] ?? ""`），缺失时为空字符串，`restoreMembers` 对无 session 引用的成员 fallback 到 `SessionManager.create()`。
