## Why

当前开屏页（WelcomeBanner）仅展示品牌信息和快捷键列表，对 team 模式用户无实际价值。团队用户启动后需要手动输入指令才能了解团队状态（成员、任务、目标），缺乏"一眼看全局"的能力。将开屏页替换为团队看板，让用户启动即获得团队全貌，并能直接操作（切成员、切团队），显著降低 team 模式的认知负担。

## What Changes

- **新增 TeamDashboard 组件**：替换 WelcomeBanner，在开屏页展示 Mission / Goals / Members / Tasks 四个 section，支持 j/k 导航和 Enter 选中操作
- **新增 TeamStatusBar 组件**：将 InputBox 中的 TeamTopology（树形多行）精简为单行状态条（`★ leader | ⠦ lysosome·T1 | ✓ ribosome·T2`），节省垂直空间
- **新增 `\` 快捷键**（normal mode）：随时唤出/关闭 TeamDashboard，不限于开屏页
- **开屏页团队切换**：TeamDashboard 底部 "Other Teams" section，j/k 选择 + Enter 切换到其他 session 的团队（调用 `client.switchSession()`）
- **扩展 AgentClient 接口**：新增 `listGoals()`、`readTeamMd()`、`listTeamSummaries()` 方法，InProcessClient 透传 TeamManager，HttpClient 新增 REST 端点
- **修改 WelcomeBanner 渲染条件**：仅在 `!showDashboard && isWelcome` 时显示，有团队时默认显示 TeamDashboard

## Capabilities

### New Capabilities

- `team-dashboard`: 团队看板组件——展示 Mission/Goals/Members/Tasks，支持键盘导航与交互操作，开屏页可切换团队
- `team-status-bar`: 单行团队状态条——替代 TeamTopology 在 InputBox 中的位置，紧凑展示所有成员状态
- `team-summary-api`: AgentClient 团队摘要接口——listGoals / readTeamMd / listTeamSummaries，支持跨 session 团队发现

### Modified Capabilities

- `team-topology-view`: 渲染位置从 InputBox 内移除，由 TeamStatusBar 替代；TeamTopology 组件保留但不再在 InputBox 中渲染
- `tui-layout`: 主内容区新增 showDashboard 状态分支，`\` 键绑定 toggleDashboard action

## Impact

- **TUI 层**：App.tsx 渲染逻辑变更（新增 showDashboard 分支）、InputBox.tsx（TeamTopology → TeamStatusBar）、keymap.ts（新增 `\` 绑定）
- **Client 层**：AgentClient 接口扩展（3 个新方法），InProcessClient 透传，HttpClient 新增 3 个 REST 端点
- **Server 层**：AgentServer 新增 3 个 handler（handleListGoals / handleReadTeamMd / handleListTeamSummaries）+ 3 个 HTTP route
- **组件**：新增 TeamDashboard.tsx、TeamStatusBar.tsx；WelcomeBanner.tsx 保留但条件渲染变更
- **无 breaking change**：TeamTopology 组件代码保留，仅改变使用位置；AgentClient 新增方法为纯增量
