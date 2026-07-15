## 1. 类型定义与 AgentClient 接口扩展

- [x] 1.1 在 `src/client/types.ts` 新增 `TeamSummary` 接口（sessionId, sessionName, mission, memberCount, activeCount, goalCount, taskCount）
- [x] 1.2 在 `src/client/types.ts` 的 `AgentClient` 接口新增 `listGoals()`、`readTeamMd()`、`listTeamSummaries()` 三个方法签名

## 2. AgentServer handler 实现

- [x] 2.1 在 `src/server/index.ts` 新增 `handleListGoals(filter)` — 透传 `this.teamManager.listGoals(filter)`
- [x] 2.2 在 `src/server/index.ts` 新增 `handleReadTeamMd()` — 透传 `this.teamManager.files.readTeamMd()`
- [x] 2.3 在 `src/server/index.ts` 新增 `handleListTeamSummaries()` — 扫描 `teamDir()` 子目录 + 读 TEAM.md + 查 sessions.db，返回 TeamSummary[]
- [x] 2.4 在 `src/server/index.ts` 的 HTTP route 注册新增 GET `/team/goals`、`/team/md`、`/team/summaries` 三个端点

## 3. InProcessClient 与 HttpClient 实现

- [x] 3.1 在 `src/client/in-process.ts` 实现 `listGoals()`、`readTeamMd()`、`listTeamSummaries()` — 透传 server handler
- [x] 3.2 在 `src/client/http.ts` 实现 `listGoals()`、`readTeamMd()`、`listTeamSummaries()` — GET 请求对应端点

## 4. TeamStatusBar 组件

- [x] 4.1 创建 `src/tui/components/TeamStatusBar.tsx` — 单行状态条，props: members, tasks, activeMemberName
- [x] 4.2 实现单行格式渲染：`★ leader | {statusIcon}{name}·{taskId} | ...`，active member 高亮
- [x] 4.3 实现文本截断逻辑（超出宽度时截断到最后一个完整 segment + `…`）
- [x] 4.4 实现 spinner 动画（有 active 成员时 120ms 刷新，无时停止）

## 5. TeamDashboard 组件

- [x] 5.1 创建 `src/tui/components/TeamDashboard.tsx` — 主看板组件，props: members, tasks, goals, teamMd, teamSummaries, activeMemberName, isWelcome, onSelectMember, onSelectTeam
- [x] 5.2 实现 Header section：`★ openagent · team mode` + Mission 行（空时省略）
- [x] 5.3 实现 Goals section：每个 goal 一行，status icon + id + title + [status] + priority，空时省略
- [x] 5.4 实现 Members section：每个 member 一行，status icon + name/role + taskInfo，active 高亮
- [x] 5.5 实现 Tasks section：每个 task 一行，id + title + assignee + [type]，done 用 textMuted 色，空时省略
- [x] 5.6 实现 Other Teams section（仅 isWelcome 时）：列出非当前 session 的团队，j/k 选择
- [x] 5.7 实现快捷键提示行：`j/k=nav  Tab=section  Enter=select  \=close  /help /model ...`
- [x] 5.8 实现内部导航状态：cursorSection + cursorIndex，j/k 移动，Tab 切换 section，Enter 选中
- [x] 5.9 实现选中操作：Members → onSelectMember，Teams → onSelectTeam，d → onSelectMember + 关闭 dashboard
- [x] 5.10 实现 loading 状态：members 为空时显示 loading 占位

## 6. App.tsx 集成

- [x] 6.1 新增 `showDashboard` 状态，默认值 `isWelcome && members.length > 0`
- [x] 6.2 修改渲染逻辑：`showDashboard ? TeamDashboard : (isWelcome ? WelcomeBanner : MessageList)`
- [x] 6.3 新增 `goals`/`teamMd`/`teamSummaries` 状态，通过 `client.listGoals()`/`client.readTeamMd()`/`client.listTeamSummaries()` 初始化
- [x] 6.4 在 subscribeTeam 回调中刷新 goals/teamMd/teamSummaries
- [x] 6.5 在 onSessionChange 回调中刷新 goals/teamMd/teamSummaries
- [x] 6.6 替换 InputBox 中的 TeamTopology 为 TeamStatusBar
- [x] 6.7 传递 TeamDashboard 所需 props（members, tasks, goals, teamMd, teamSummaries, isWelcome, onSelectMember, onSelectTeam）

## 7. 快捷键绑定

- [x] 7.1 在 `src/tui/keymap.ts` 新增 `{ mode: "normal", key: { name: "\\" }, action: "toggleDashboard", desc: "Toggle team dashboard" }`
- [x] 7.2 在 App.tsx 的 useKeyboard switch 中新增 `case "toggleDashboard": setShowDashboard(v => !v); return`
- [x] 7.3 处理 Escape/i 关闭 dashboard 逻辑：showDashboard 时 Escape 关闭 dashboard（不切 mode），i 关闭 dashboard 并切到 insert mode

## 8. 验证

- [x] 8.1 运行 `bun run check` 确保 typecheck + lint + test 通过
- [ ] 8.2 手动验证：启动 TUI，开屏页有团队时显示 TeamDashboard
- [ ] 8.3 手动验证：\ 键唤出/关闭看板，j/k/Tab/Enter 导航
- [ ] 8.4 手动验证：开屏页 Other Teams section 切换团队
- [ ] 8.5 手动验证：TeamStatusBar 单行显示正确，spinner 动画正常
