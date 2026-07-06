---
type: project
created: 2026-07-06T00:00:00.000Z
updated: 2026-07-06T00:00:00.000Z
tokens: 0
---
# Core Architecture & Recent Key Changes

> 深入分析 vc-agent (openagent) 项目的核心架构和近期关键变更。

---

## 1. Agent 会话流程 (`src/agent/session.ts`)

### 双层入口
- **Legacy 路径**: `createSession()` — 创建内存 SessionManager（非持久化），保留向后兼容
- **Runtime 路径**: `createRuntime()` — 创建持久化的 AgentSessionRuntime，支持 TUI 内热切换 (`switchSession` / `newSession`)

### Pi SDK 集成
- 使用 `createAgentSessionRuntime(factory, { cwd, agentDir, sessionManager })` — factory 函数签名 `CreateAgentSessionRuntimeFactory`
- `createRuntime` 创建的 factory 在每次 switch/new 时被调用，此时:
  1. 清理旧的 bridge（`clearBridge`, `clearEditConfirmBridge`）
  2. 根据 `agentMode` 决定工具组合（team mode vs standard mode）
  3. 调用 `createAgentSession` 构建新会话

### 双名单机制（Dual-allowlist）
这是项目与 Pi SDK 工具集成的关键设计：

```
createAgentSession({
  tools: ["read", "bash", "write", "grep", "find", "edit", "todo", ...],  // 白名单——Pi SDK 内置工具名
  customTools: [lspTool, editTool, questionTool, mcpTool, ...],            // 外部工具定义注册
})
```

- **`tools`** (白名单): Pi SDK 内部注册表已有工具名（来自 `@earendil-works/pi-coding-agent` 内置）。只声明名称即可激活
- **`customTools`**: 完全由项目层定义的工具（LSP/MCP/team/memory 等），包含完整的 name/description/parameters/execute
- MCP 工具按条件添加：`mcpManager.getToolDefinitions().length > 0` 时，白名单加 `"mcp"`，customTools 加定义

### 模式切换时的白名单重建
```typescript
// src/server/index.ts handleSetAgentMode():
const hasMcp = this.mcpManager.getToolDefinitions().length > 0;
this.session.setActiveToolsByName([...activeToolsFor(mode), ...(hasMcp ? ["mcp"] : [])]);
```

- `activeToolsFor(mode)`: standard → STANDARD_ACTIVE_TOOLS, planner → PLANNER_ACTIVE_TOOLS (read-only), team → TEAM_ACTIVE_TOOLS
- Orchestrator/team 模式额外注入 system prompt: `session.steer(ORCHESTRATOR_SYSTEM_PROMPT)` 和/或 `session.steer(TEAM_ORCHESTRATOR_PROMPT)`

### 模式循环
```typescript
buildAgentModeCycle(config):
  teams.enabled=true  → standard → team → planner → orchestrator → standard
  teams.enabled=false → standard → planner → orchestrator → standard
```
可通过 Tab 键或 `/plan` 命令循环切换。

### 共享服务 (initServices)
`createRuntime` 层一次性初始化、跨会话复用的服务：
- `AuthStorage` (inMemory) + `ModelRegistry` (inMemory)
- `SettingsManager` (inMemory)
- `SkillManager` (初始化 → resourceLoader)
- `LspClient` (spawns typescript-language-server)
- `McpManager` (connect MCP servers)

这些在 factory 闭包中被引用，跨 session switch 保持存活。

---

## 2. 服务端架构 (`src/server/index.ts`)

### AgentServer 类
核心编排器，封装 `AgentSessionRuntime` 并暴露完整客户端 API。

#### 构造流程
1. 创建 `NotificationRouter` — 事件 → 通知管道（config 来自 `.openagent/config.json` notifications 段）
2. `setGlobalRouter(router)` — 使 question tool 等下层模块可获取通知能力
3. 创建 `TeamManager`（传入 `runtime.services`）
4. 设置 `runtime.setRebindSession` 回调 — 会话切换时:
   - **未提交变更**: 移除了 `await this.disposeTeam()` — 团队在会话切换后保持存活
   - `resubscribe()` — 重新绑定事件订阅
   - 通知所有 `sessionChangeHandlers`
5. `ensureSubscribed()` — 初始化事件订阅

#### 事件订阅管道 (`ensureSubscribed`)
```
AgentSessionEvent
  ├─→ NotificationRouter.handleEvent() — 通知系统
  │     ├─→ TUI Toast (always when TUI)
  │     ├─→ OSC → OS native → silent fallback
  │
  └─→ eventHandlers (TUI 渲染层等)
```

```
TeamEvent
  └─→ teamEventHandlers (AgentServer 内部)
        ├─ member_done → session.steer()/prompt() 注入成员摘要给 leader
        ├─ member_error → session.steer()/prompt() 注入错误信息
        └─ 其他事件 → TUI 广播
```

#### resubscribe 机制
会话切换时（`switchSession`/`newSession`）:
1. 取消旧订阅 (`currentUnsub()`)
2. 重新调用 `ensureSubscribed()` 绑定新 session

#### 信号处理
```typescript
process.once("SIGINT", dispose);  // → disposeTeam() + mcpManager.dispose() + exit(0)
process.once("SIGTERM", dispose);
```

### AgentClient 接口
`AgentServer` 实现了 `AgentClient`（定义在 `src/client/types.ts`），所有 handle 方法直接委托给 Session/Runtime/TeamManager。这构成 TUI 和后端的统一接口层。

---

## 3. 团队系统 v2 (`src/teams/manager-v2.ts`)

### Doc-driven 架构 — TEAM.md 即状态
**核心原则**: 文件系统就是数据库。所有团队状态持久化在 `.openagent/team/` 目录下，由 markdown 文件承载。

#### 目录结构
```
.openagent/team/
├── TEAM.md                    # 团队状态：Mission, Members Table, Active Tasks, Important Notes, Shared Memory Index
├── members/
│   ├── <name>.md             # 成员 index: Profile, Active Context, Memory Index, Recent Activity
│   ├── <name>/               # 成员 topic 文件目录
│   │   ├── <topic>.md        # YAML frontmatter + content (type/created/updated/tokens)
│   │   └── ...
│   └── _archived/<name>/     # 已移除成员的归档
└── shared/
    └── <topic>.md             # 团队共享 topic 文件 (project/reference 类型)
```

### 成员生命周期

```typescript
create → idle → [assignTask] → active → [agent_end] → idle → [remove] → archived
                    ↓                       ↓
                  paused ←→ [resume]     completeTask
                    ↓
                 cancelled
```

- **create**: 初始化成员目录+index → 创建独立 `AgentSession`（工具白名单: `read/bash/grep/find` + memory tool）→ 写入 TEAM.md members table
- **assignTask**: 更新 TEAM.md + member .md → 构建 L4 任务层 system prompt → `steer()`/`prompt()` 注入
- **pause**: abort session → 状态=paused → 更新 TEAM.md
- **resume**: 重建 compaction re-inject (L2+L3) → `prompt()` 恢复 + 上次任务
- **cancel**: abort + dispose session → 删除状态
- **remove**: unsubscribe + dispose + 归档文件 → 更新 TEAM.md

### 分层 System Prompt (L1-L5)

| 层级 | 名称 | 内容来源 | 注入时机 |
|------|------|----------|----------|
| L1 | Identity | role + goal + agentSystemPrompt | 会话创建（`buildMemberSystemPrompt`） |
| L2 | Memory Index | member .md（profile/activeContext/memoryIndex/recentActivity） | 创建 + compaction 后 re-inject |
| L3 | TEAM.md Summary | Members table + Active Tasks + Important Notes | 创建 + compaction 后 re-inject |
| L4 | Task | 当前任务描述 | `assignTask` 时 steer/prompt |
| L5 | Topic Files | 单个 topic .md 内容 | memory tool `action=read` 时返回 |

### SessionManager 集成
每个 team member 拥有独立的 Pi SDK `AgentSession`，通过 `createAgentSession`（非 runtime）创建。使用 `DefaultResourceLoader`（禁用 extensions/skills/contextFiles）和有限工具集。

### Auto-memory 压缩回调

```typescript
handleMemberEvent → event.type === "compaction_end" →
  1. extractLastAssistantText(session) → compaction summary
  2. handleCompactionEnd({ files, memberName, compactionSummary })
     a. parseCompactionSummary → 提取 Goal/Progress/Learnings/NextSteps
     b. classifyLearnings → 按 [user]/[feedback]/[project]/[reference] 分类
     c. writeTopicFile → 写入成员 topic 文件 + 更新索引
     d. compressMemberIndex → 若 >200 行则截断
  3. buildCompactionReinject → L2 + L3 重新注入 via session.steer()
```

### TeamFiles 文件操作
- 原子写入: `writeFileSync(tmp) → renameSync(tmp, target)`
- Shared 写入使用 `proper-lockfile` 锁
- 验证: `validateName` — 限制 `[a-z0-9-]` 防止路径穿越

### TeamManagerRef 模式
```typescript
export interface TeamManagerRef {
  current: TeamManagerLike | null;
}
```
延迟引用模式（沿用原 WorkerPoolRef 风格），由 AgentServer 在构造函数中设置 `ref.current = this.teamManager`，工具层通过 ref 获取实时 Manager 实例。

---

## 4. MCP 集成 (`src/mcp/`)

### 单工具合并（commit f9cce93）
所有 MCP server 的所有工具合并为**一个** `mcp` 工具：

```typescript
parameters: {
  server_name: string,   // 从 connected servers 枚举
  tool_name: string,     // 目标工具名
  arguments: object,      // 传递给被调用工具的参数
}
```

`createMcpToolDefinition` 构建工具目录（catalog），列出所有 server 及其工具，注入到 `mcp` 的 description 中供 LLM 参考。

### 配置层次
- 全局: `~/.config/openagent/mcp.json`
- 项目: `.openagent/mcp.json`
- 合并策略: 项目覆盖全局（浅合并 `{...global, ...project}`）

### Remote server 配置
```json
{
  "server-name": {
    "type": "remote",
    "url": "http://...",
    "headers": { "Authorization": "env:MY_API_KEY" }
  }
}
```
- 连接策略: `StreamableHTTPClientTransport` → 失败则 fallback `SSEClientTransport`
- `env:VAR` 语法解析为 `process.env[VAR]`

### Local server 配置
```json
{
  "server-name": {
    "type": "local",
    "command": ["node", "server.js"],
    "env": { "TOKEN": "env:SECRET" },
    "cwd": "/path/to/server"
  }
}
```
- 使用 `StdioClientTransport` spawn 进程
- `env:` 解析同样适用

### 连接管理
- 所有 server 并行连接 (`Promise.allSettled`)，失败的不阻塞其他
- 5 秒连接超时
- 启动日志: `[mcp] Connected: serverA(3 tools), serverB(5 tools) — 8 tools total`

---

## 5. LSP 集成 (`src/lsp/`)

### 架构: 自定义 JSON-RPC LSP Client
- 不使用 vscode-languageserver-node，完全自实现
- 通过 `spawn("typescript-language-server", ["--stdio"])` 以 stdio 通信
- Content-Length 头分帧的 JSON-RPC 协议

### LspClient 核心能力
- **诊断**: `getDiagnostics(filePath)` — 通过 `textDocument/publishDiagnostics` 通知收集
- **导航**: `gotoDefinition/TypeDefinition/Implementation` — `Location[]`
- **引用查找**: `findReferences(filePath, line, char)` — 含重试（最多 3 次，250ms 间隔）
- **Hover**: `hover(filePath, line, char)` — 类型/签名信息
- **符号**: `documentSymbol(filePath)` + `workspaceSymbol(query)`
- **代码操作**: `codeAction(filePath, range, context)` — quick fixes/refactors
- **重命名**: `prepareRename` (检查可用性) + `rename` (产生 WorkspaceEdit)
- **原始请求**: `rawRequest(method, params)` — 任意 LSP 方法

### 文件生命周期
调用前自动 `ensureFileOpen(filePath)` → `didOpen` + 200ms sleep for diagnostics

### 统一 lsp 工具 (14 actions)
```typescript
action: "diagnostics" | "definition" | "type_definition" | "implementation" 
      | "references" | "hover" | "document_symbols" | "workspace_symbols"
      | "code_actions" | "rename" | "prepare_rename" | "status" | "reload" | "request"
```
支持 `symbol` 参数自动解析列位置（`resolveSymbolColumn`），`apply=true` 直接写入文件。

---

## 6. 工具架构总结

### 工具清单
| 类别 | 工具名 | 注册方式 | 说明 |
|------|--------|----------|------|
| Pi SDK 内置 | read, bash, write, grep, find | `tools` 白名单 | 始终可用 |
| 自定义通用 | edit, todo, question, notify, webfetch, subagent | `customTools` | 编辑/TODO/交互式问询/通知/网页抓取/子代理 |
| LSP | lsp | `customTools` | 统一 LSP 工具（14 个 action） |
| MCP | mcp | `tools` + `customTools` | 统一 MCP 工具（含 server_name + tool_name + arguments） |
| 团队 (v2) | team, memory | `customTools` | 7 合 2（commit 8d8aea5） |
| 团队守卫 | bash*, write* | `customTools` | 替换内置 bash/write，阻止直接修改 .openagent/team/ |

### 模式-工具矩阵
| Mode | 内置 tools | 额外工具 |
|------|-----------|---------|
| standard | read/bash/write/grep/find/edit/todo/question/subagent/webfetch | lsp, (mcp) |
| planner | read/bash/grep/find/todo/question/webfetch | lsp, (mcp) |
| team | read/bash/write/grep/find/edit/todo/question/webfetch/team/memory | lsp, (mcp), guarded bash/write (替换原生) |
| orchestrator | (同 team tools) + 注入 ORCHESTRATOR prompt | lsp, (mcp) |

---

## 7. 关键 Commits 详情

| Commit | 日期 | 变更 |
|--------|------|------|
| `f9cce93` | 近期 | MCP 单工具合并：所有 MCP tool 合并为一个 `mcp` tool |
| `8d8aea5` | 近期 | Teams 工具精简：7 个独立 team 工具 → 2 个（team + memory）+ 守卫 bash/write |
| `74b0ff0` | 近期 | 文档更新：AGENTS.md 添加 MCP single-tool 说明 |
| `00be78e` | 近期 | 文档更新：AGENTS.md 添加 Pi SDK dual-allowlist 说明 |
| `8abac6a` | 近期 | MCP 工具名加入 Pi SDK tools 白名单 |
| `2cf0873` | 近期 | Team doc-driven 架构替代 WorkerSessionPool |

### 未提交 Diff
1. **`src/server/index.ts`**: 移除 `setRebindSession` 回调中的 `await this.disposeTeam()` — 团队现在在会话切换后保持存活
2. **`src/tui/App.tsx`**: 在 `agent_end` 事件处理中添加 `setMembers(client.listMembers())` + `setActiveMemberName(null)` — 流完成时刷新团队状态
3. `.openagent/config.json` 和 `.openagent/team/TEAM.md` — 配置和团队文件变更
