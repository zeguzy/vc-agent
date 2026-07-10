## Context

当前 AgentClient 接口（`src/client/types.ts`）暴露了 6 个内部对象 getter，让 TUI 可以绕过 Client-Server 边界直接操作 Server 内部对象：

```typescript
// 当前 AgentClient 接口中的泄露方法
getSession(): AgentSession;           // Pi SDK 内部类型
getRuntime(): AgentSessionRuntime;    // Pi SDK 内部类型
getSkillManager(): SkillManager;      // 内部模块
getSettingsManager(): SettingsManager; // 内部模块
getModelRegistry(): ModelRegistry;    // 内部模块
getAuthStorage(): AuthStorage;        // 内部模块
```

HttpClient 对这些方法只能抛 NotSupportedError，远程客户端无法使用 skill/model/auth/settings 功能。

TUI 实际使用的内部 API 表面（基于完整调用点分析）：

| 泄露方法 | TUI 使用的内部 API | 调用位置 |
|---------|-------------------|---------|
| `getSession()` | `setModel()`, `getAvailableThinkingLevels()`, `setThinkingLevel()`, `getUserMessagesForForking()`, `sessionManager.getEntry(id)?.parentId`, `navigateTree()` | App.tsx, commands.ts, settings/definitions.ts |
| `getRuntime()` | **无调用者** | — |
| `getSkillManager()` | `listSkills()`, `getDefaultDirectories()`, `loadDynamicSkill()`, `unloadDynamicSkill()` | commands.ts, InputBox.tsx |
| `getSettingsManager()` | `setCompactionEnabled()` | settings/definitions.ts |
| `getModelRegistry()` | `getAll()`, `find()` | ModelPicker.tsx, settings/definitions.ts |
| `getAuthStorage()` | `hasAuth()`, `setRuntimeApiKey()` | ModelPicker.tsx |

## Goals / Non-Goals

**Goals:**

- AgentClient 接口不暴露任何内部对象引用，只返回值类型
- 所有 TUI 调用点通过新的值类型方法操作，不直接持有内部对象
- HttpClient 能完整实现所有 AgentClient 方法（无 NotSupportedError）
- HTTP Server 新增 REST 端点支持远程客户端
- SettingContext 类型不包含内部对象字段

**Non-Goals:**

- 不拆分 CommandContext（后续 Change 2）
- 不引入 Server 状态机（后续 Change 3）
- 不引入权限体系（后续 Change 4）
- 不改变 Pi SDK agent loop 逻辑
- 不改变 AgentServer 内部组合方式
- 不改变 session 持久化格式

## Decisions

### 决策 1: 值类型方法替代内部对象 getter

**选择**：为每个泄露 getter 的实际使用 API 创建独立的值类型方法。

**替换映射**：

| 原泄露方法 | 新 AgentClient 方法 | 返回类型 |
|-----------|---------------------|---------|
| `getSession().setModel(model)` | `setModel(provider, id)` | `Promise<void>` |
| `getSession().getAvailableThinkingLevels()` | `getAvailableThinkingLevels()` | `readonly string[]` |
| `getSession().setThinkingLevel(level)` | `setThinkingLevel(level)` | `void` |
| `getSession().getUserMessagesForForking()` | `getUserMessagesForForking()` | `UserMessageSummary[]` |
| `getSession().sessionManager.getEntry(id)?.parentId` | `getEntryParentId(entryId)` | `string \| undefined` |
| `getSession().navigateTree(parentId)` | `navigateTree(parentId)` | `Promise<NavigateResult>` |
| `getRuntime()` | **删除**（无调用者） | — |
| `getSkillManager().listSkills()` | `listSkills()` | `SkillListResult` |
| `getSkillManager().getDefaultDirectories()` | `getSkillDirectories()` | `SkillDirectories` |
| `getSkillManager().loadDynamicSkill(path)` | `loadDynamicSkill(path)` | `Promise<LoadSkillResult>` |
| `getSkillManager().unloadDynamicSkill(name)` | `unloadDynamicSkill(name)` | `Promise<boolean>` |
| `getSettingsManager().setCompactionEnabled(v)` | `setCompactionEnabled(enabled)` | `void` |
| `getModelRegistry().getAll()` | `listModels()` | `ExtendedModelInfo[]` |
| `getModelRegistry().find(p, id)` | `findModel(provider, id)` | `ExtendedModelInfo \| undefined` |
| `getAuthStorage().hasAuth(provider)` | `hasAuthProvider(provider)` | `boolean` |
| `getAuthStorage().setRuntimeApiKey(p, key)` | `setRuntimeApiKey(provider, key)` | `void` |

**理由**：
- 值类型方法可序列化——HttpClient 通过 REST 调用，返回 JSON
- 接口不暴露实现细节——TUI 不知道 Server 内部用什么 SkillManager/ModelRegistry
- 每个方法有明确的语义——比 `getSession().sessionManager.getEntry(id)?.parentId` 清晰得多

**替代方案**：保留 getter 但让 HttpClient 返回代理对象。放弃——代理对象无法跨 HTTP 传输，且仍暴露内部类型。

### 决策 2: 新增值类型定义

**选择**：在 `src/client/types.ts` 中新增以下值类型：

```typescript
// /undo 命令需要
interface UserMessageSummary {
  entryId: string;
  text: string;
}

interface NavigateResult {
  cancelled: boolean;
  lastUserText?: string;
}

// /skills 命令需要
interface SkillListResult {
  skills: Array<{
    name: string;
    description: string;
    source: "auto" | "dynamic";
    disableModelInvocation: boolean;
    filePath?: string;
  }>;
}

interface SkillDirectories {
  global: string;
  project: string;
}

interface LoadSkillResult {
  name: string;
  description: string;
  filePath: string;
  disableModelInvocation: boolean;
}

// ModelPicker 需要——扩展现有 ModelInfo
interface ExtendedModelInfo extends ModelInfo {
  provider: string;
  reasoning?: boolean;
  input?: number;
}
```

**理由**：
- 值类型只包含 TUI 实际需要的字段，不暴露内部对象的完整 API
- `ExtendedModelInfo` 继承 `ModelInfo`（保持向后兼容），新增 ModelPicker 需要的 `provider`/`reasoning`/`input`
- `UserMessageSummary` 只含 `entryId`/`text`，不含 sessionManager 引用

### 决策 3: SettingContext 重构

**选择**：`SettingContext` 移除 `session`/`settingsManager`/`modelRegistry`/`authStorage` 字段，改用 `client: AgentClient`。

**当前 SettingContext**（`src/settings/types.ts`）：
```typescript
interface SettingContext {
  session: AgentSession;        // ← 泄露
  settingsManager: SettingsManager;  // ← 泄露
  modelRegistry: ModelRegistry;      // ← 泄露
  authStorage: AuthStorage;          // ← 泄露
  client: AgentClient;
  // ...
}
```

**重构后**：
```typescript
interface SettingContext {
  client: AgentClient;  // ← 唯一通道
  // ...
}
```

**迁移**：
- `ctx.session.setModel(model)` → `ctx.client.setModel(provider, id)`
- `ctx.session.getAvailableThinkingLevels()` → `ctx.client.getAvailableThinkingLevels()`
- `ctx.session.setThinkingLevel(value)` → `ctx.client.setThinkingLevel(value)`
- `ctx.settingsManager.setCompactionEnabled(v)` → `ctx.client.setCompactionEnabled(v)`
- `ctx.modelRegistry.find(p, id)` → `ctx.client.findModel(p, id)`
- `ctx.modelRegistry.getAll()` → `ctx.client.listModels()`
- `ctx.authStorage.hasAuth(p)` → `ctx.client.hasAuthProvider(p)`
- `ctx.authStorage.setRuntimeApiKey(p, k)` → `ctx.client.setRuntimeApiKey(p, k)`

### 决策 4: 三阶段迁移——先增后删

**选择**：Phase A 新增方法（不改旧行为）→ Phase B TUI 迁移 → Phase C 删除泄露方法。

**理由**：
- Phase A 可以独立验证——新方法存在但不被调用，零风险
- Phase B 逐文件迁移——每个文件迁移后可独立测试
- Phase C 一次性删除——所有调用点已迁移，删除是安全的

**替代方案**：一次性替换所有调用点。放弃——改动面太大，难以定位回归问题。

### 决策 5: HttpClient REST 端点设计

**选择**：为每个新方法添加对应的 REST 端点。

| 方法 | HTTP 端点 | 方法 |
|------|----------|------|
| `setModel(provider, id)` | `POST /model` | `{ provider, id }` |
| `getAvailableThinkingLevels()` | `GET /model/thinking-levels` | — |
| `setThinkingLevel(level)` | `POST /model/thinking-level` | `{ level }` |
| `getUserMessagesForForking()` | `GET /session/fork-messages` | — |
| `getEntryParentId(entryId)` | `GET /session/entry-parent/:entryId` | — |
| `navigateTree(parentId)` | `POST /session/navigate` | `{ parentId }` |
| `listSkills()` | `GET /skills` | — |
| `getSkillDirectories()` | `GET /skills/directories` | — |
| `loadDynamicSkill(path)` | `POST /skills/load` | `{ path }` |
| `unloadDynamicSkill(name)` | `POST /skills/unload` | `{ name }` |
| `setCompactionEnabled(enabled)` | `POST /settings/compaction` | `{ enabled }` |
| `listModels()` | `GET /models` | — |
| `findModel(provider, id)` | `GET /models/:provider/:id` | — |
| `hasAuthProvider(provider)` | `GET /auth/has/:provider` | — |
| `setRuntimeApiKey(provider, key)` | `POST /auth/api-key` | `{ provider, key }` |

**理由**：REST 端点与 AgentClient 方法 1:1 对应，HttpClient 实现直观。

### 决策 6: 修复 onSessionChange 泄露（Oracle 条件 1）

**选择**：将 `onSessionChange` 回调签名从 `(session: AgentSession) => Promise<void>` 改为 `(sessionId: string) => Promise<void>`。

**当前签名**：
```typescript
onSessionChange(handler: (session: AgentSession) => Promise<void>): void;
```

**修复后**：
```typescript
onSessionChange(handler: (sessionId: string) => Promise<void>): void;
```

**理由**：
- 当前 `onSessionChange` 回调将完整的 `AgentSession` 对象推给 TUI，是"反向泄露"（push 而非 pull）
- TUI 在 `onSessionChange` 回调中实际只需要知道"session 变了"——通过 `getSessionId()` + 事件流即可响应
- 改为 `sessionId` 后，HttpClient 可以通过 SSE 事件流推送 session 变更通知，无需传递内部对象

**TUI 迁移**：App.tsx 中 `onSessionChange` 回调当前直接使用 `session` 对象。改为收到 `sessionId` 后通过 `client.getContextUsage()` 等值类型方法获取需要的状态。

### 决策 7: HTTP 安全模型（Oracle 条件 2）

**选择**：对敏感 REST 端点增加安全约束。

**约束 1：HTTP Server 绑定 localhost**

当前 `server/http.ts` 的 `listen(port)` 绑定所有接口。改为 `listen(port, "127.0.0.1")`，仅接受本地连接。这是安全基线——远程客户端通过 SSH 隧道或显式端口转发访问，而非直接暴露到网络。

**约束 2：loadDynamicSkill 路径验证**

Server 端 `handleLoadDynamicSkill(path)` 必须验证 `path` 在允许的 skill 目录内（`SkillManager.getDefaultDirectories()` 返回的 global/project 目录）。路径验证逻辑：
```typescript
const resolved = resolve(path);
const dirs = this.skillManager.getDefaultDirectories();
const allowed = [dirs.global, dirs.project].map(d => resolve(d));
if (!allowed.some(d => resolved.startsWith(d + sep))) {
  throw new Error(`Skill path outside allowed directories: ${path}`);
}
```

**约束 3：setRuntimeApiKey 安全性**

`setRuntimeApiKey` 在 HTTP 端点中仅设置内存中的运行时 key（不持久化）。风险可接受——攻击者需要已有 localhost 访问权限，且设置的 key 在进程重启后丢失。不额外增加认证机制，因为 HTTP Server 已限定 localhost。

### 决策 8: navigateTree HTTP 可行性（Oracle 条件 3）

**选择**：`navigateTree` 在 HTTP 模式下支持，通过 `POST /session/navigate` 端点。

**可行性分析**：
- `navigateTree(parentId)` 内部调用 `session.navigateTree(parentId)`，返回 `NavigateResult`
- 对于 HTTP 客户端，Server 执行 navigate 后返回 `{ cancelled, lastUserText }` 值类型
- 客户端通过 SSE 事件流自动收到 session 变更通知（已有 `session.switchSession` 事件）
- `/undo` 命令的 3 步流程（`getUserMessagesForForking` → `getEntryParentId` → `navigateTree`）在 HTTP 上需要 3 次 REST 调用，但每步都是独立的幂等操作，不需要原子性保证
- HttpClient 在 `navigateTree` 后需要刷新缓存（`init()` 重新拉取 session 状态）

**结论**：`navigateTree` 可以在 HTTP 模式下实现，不需要 NotSupportedError。

## Risks / Trade-offs

- **[接口方法数增加]** AgentClient 从 ~40 方法增至 ~55 方法。Mitigation：每个方法语义明确、值类型返回，比 6 个泄露 getter 更可维护。后续可按领域拆分子接口（如 TeamClient/SkillClient）。
- **[SettingContext 迁移影响 settings 系统]** 所有 setting apply() 函数需要改写。Mitigation：setting 只有 3 个 apply 函数受影响，改动量小。
- **[/undo 命令复杂度]** `getUserMessagesForForking()` + `getEntryParentId()` + `navigateTree()` 三个方法替代了直接操作 session。Mitigation：语义更清晰，且可远程化。
- **[ModelInfo 扩展向后兼容]** `ExtendedModelInfo extends ModelInfo` 新增字段。Mitigation：新增字段都是可选的，不影响现有代码。
- **[onSessionChange 签名变更]** 回调参数从 `AgentSession` 改为 `string`。Mitigation：当前只有 App.tsx 一处注册回调，迁移简单。
- **[HTTP Server localhost 绑定]** 绑定 127.0.0.1 可能影响某些使用场景（如 Docker 内访问）。Mitigation：用户可通过 SSH 隧道或显式 `--host 0.0.0.0` 参数覆盖（后续添加）。
