## Context

当前 openagent 启动后，开屏页显示 WelcomeBanner（品牌 + 快捷键列表）。team 模式用户需要手动输入指令才能了解团队状态。团队数据已就绪（members/tasks/goals 通过 TeamManager 管理），但 TUI 层缺少全局视图。

现有架构关键点：
- 团队是 **per-session** 的：每个 session 在 `~/.config/openagent/team/<sessionId>/` 下有独立 TEAM.md
- "切团队" = 切 session（`client.switchSession()` → AgentServer rebind → 新 TeamManager）
- App.tsx 已有 `members`/`activeMemberName` 状态和 `subscribeTeam()` 实时更新
- TeamTopology 嵌在 InputBox 中，占 3-10 行垂直空间

```
当前渲染流程:

App.tsx
├── isWelcome ? WelcomeBanner : MessageList
├── InputBox
│   ├── TeamTopology (3-10 行树形)
│   └── textarea
└── StatusBar
```

## Goals / Non-Goals

**Goals:**
- 开屏页有团队时自动显示 TeamDashboard，一眼看全局（Mission/Goals/Members/Tasks）
- 任何时刻 `\` 键唤出看板，Escape/i 关闭
- 开屏页可切换到其他 session 的团队（j/k + Enter）
- 看板内可选中 member 并跳转到其子会话视图
- TeamTopology 精简为单行 TeamStatusBar，节省垂直空间
- AgentClient 接口扩展，支持跨 session 团队发现

**Non-Goals:**
- 不做 Kanban 列式布局（终端宽度不够）
- 不做看板内直接创建/删除 member 或 task（通过 /team 命令或 agent 对话操作）
- 不做看板内编辑 goal/task 状态（只读展示 + 选中跳转）
- 不改造 HttpClient 的 team API 为完整实现（仅新增 3 个端点，其余 team 方法保持 NotSupportedError）
- 不移除 TeamTopology 组件代码（仅改变使用位置）

## Decisions

### D1: showDashboard 状态管理

**决策**：在 App.tsx 新增 `showDashboard` boolean 状态，默认值由 `isWelcome && members.length > 0` 决定。

**理由**：
- 简单直接，与现有 `isWelcome`/`showSettings`/`showWorkers` 模式一致
- `\` 键 toggle，Escape/i 关闭，行为清晰
- 不需要额外状态机

**替代方案**：将 dashboard 作为独立 Mode（如 "dashboard" mode）——过度设计，dashboard 是叠加层不是独立模式。

```
改造后渲染流程:

App.tsx
├── showDashboard ? TeamDashboard : (isWelcome ? WelcomeBanner : MessageList)
├── InputBox
│   ├── TeamStatusBar (单行)
│   └── textarea
└── StatusBar
```

### D2: TeamDashboard 组件内部导航

**决策**：TeamDashboard 内部维护 `cursorSection`（"goals"|"members"|"tasks"|"teams"）和 `cursorIndex`（section 内行号），j/k 移动光标，Enter 执行操作。

**理由**：
- 与 vim 风格一致（j/k 导航），用户无需学习新交互
- section 化光标避免跨 section 跳跃混乱
- Enter 语义清晰：members → 切到 member 视图，teams → 切 session

**交互映射**：

| 按键 | Section | 行为 |
|------|---------|------|
| j/k | 任意 | section 内移动光标 |
| Enter | members | `setActiveMemberName(member.name)` + 关闭 dashboard |
| Enter | teams | `client.switchSession(sqlite://<sid>)` |
| d | members | `client.directMember(name, "directive", "")` → 跳到输入框 |
| \ | 任意 | 关闭 dashboard |
| Escape/i | 任意 | 关闭 dashboard |

### D3: TeamStatusBar 单行格式

**决策**：`★ leader | ⠦ lysosome·T1 | ✓ ribosome·T2`，用 `|` 分隔，每个 member 显示 status icon + name + currentTaskId。

**理由**：
- 单行占用最小垂直空间
- `|` 分隔符视觉清晰
- 保留 status icon 和 task 信息，信息密度足够
- 超出宽度时截断最后一个 member 并加 `…`

**替代方案**：只显示 active member 数量（如 `3 members, 1 active`）——信息量不足，无法 glance 定位。

### D4: AgentClient 接口扩展

**决策**：新增 3 个同步方法到 AgentClient 接口：

```typescript
listGoals(filter?: { status?: GoalStatus }): Goal[];
readTeamMd(): TeamMdStructure;
listTeamSummaries(): TeamSummary[];
```

**TeamSummary 类型**：
```typescript
interface TeamSummary {
  sessionId: string;
  sessionName: string | null;
  mission: string;
  memberCount: number;
  activeCount: number;
  goalCount: number;
  taskCount: number;
}
```

**InProcessClient**：直接透传 `server.teamManager.listGoals()` / `server.teamManager.files.readTeamMd()` / 新增 `handleListTeamSummaries()`。

**HttpClient**：新增 3 个 GET 端点 `/team/goals`、`/team/md`、`/team/summaries`，抛 NotSupportedError 的方法保持不变。

**listTeamSummaries 实现逻辑**：
1. 扫描 `~/.config/openagent/team/` 下的子目录
2. 每个子目录名即 sessionId
3. 读 TEAM.md 获取 mission/members/goals/tasks 摘要
4. 从 sessions.db 获取 sessionName
5. 过滤掉无 TEAM.md 或空团队的目录

**理由**：
- 同步方法与现有 `listMembers()`/`listTasks()` 风格一致
- TeamSummary 聚合了跨 session 信息，TUI 不需要直接读文件系统
- InProcessClient 透传简单，HttpClient 端点直接

**替代方案**：TUI 层直接读文件系统——绕过抽象层，HTTP 模式无法工作，违反现有架构模式。

### D5: 开屏页团队切换流程

**决策**：TeamDashboard 底部 "Other Teams" section 列出当前 session 以外的有团队 session，j/k 选中 + Enter 触发 `client.switchSession()`。

**流程**：
```
1. TeamDashboard 挂载时调用 client.listTeamSummaries()
2. 过滤掉当前 sessionId
3. 渲染 "Other Teams" section（仅 isWelcome 时显示）
4. 用户 j/k 选中 + Enter
5. client.switchSession(sqlite://<targetSessionId>)
6. AgentServer.setRebindSession 触发
   → disposeTeam() + new TeamManager(新 sessionTeamDir)
   → onSessionChange 回调
   → App 收到事件 → 刷新 members/tasks/goals
7. TeamDashboard 自动更新为新团队数据
```

**理由**：复用现有 switchSession 机制，无需新增 session 切换逻辑。

### D6: 快捷键绑定

**决策**：在 keymap.ts 新增 `{ mode: "normal", key: { name: "\\" }, action: "toggleDashboard" }`。

**理由**：
- `\` 在 normal mode 下无绑定
- 视觉上 `]` 已用于 member 切换，`\` 作为"看板"的逻辑延续直觉
- 不与现有快捷键冲突

## Risks / Trade-offs

**[R1] listTeamSummaries 扫描文件系统开销** → 仅在 TeamDashboard 挂载时调用一次，后续通过 subscribeTeam 事件驱动刷新当前团队数据。Other Teams section 不实时刷新（切换后重新挂载时刷新）。

**[R2] switchSession 后 TeamDashboard 状态重置** → rebind 后 App 的 onSessionChange 会清空 members/tasks，TeamDashboard 需要处理空数据过渡。Mitigation：TeamDashboard 在 members 为空时显示 loading 状态。

**[R3] 单行 TeamStatusBar 在成员多时信息截断** → 截断最后一个可见 member 并加 `…`，用户可按 `\` 打开完整看板。这是空间与信息密度的合理 trade-off。

**[R4] AgentClient 接口面积增长** → 3 个新方法为纯增量，不影响现有方法。HttpClient 端点实现简单（GET + JSON），维护成本低。
