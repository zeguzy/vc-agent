## 1. 基础设施：statusIcon/statusColor 统一

- [x] 1.1 在 `src/tui/utils/theme.ts` 中新增 `teamStatusIcon(status)` 和 `teamStatusColor(status)` 导出函数，覆盖 6 种 MemberState status（active/idle/done/error/paused/cancelled），逻辑与现有 MemberTags.tsx 中的同名函数逐字一致
- [x] 1.2 修改 `src/tui/components/MemberCard.tsx`：移除本地 `statusColor` 函数，改为从 `theme.ts` 导入 `teamStatusColor`；`statusIcon` 从 MemberTags.js 改为从 theme.ts 导入 `teamStatusIcon`
- [x] 1.3 修改 `src/tui/components/WorkersView.tsx`：移除本地 `statusIcon` 和 `statusColor` 函数，改为从 `theme.ts` 导入
- [x] 1.4 运行 `bun run check` 确认所有引用迁移完成且无类型错误（512 pass / 0 fail）

## 2. 新增 TeamTopology 组件

- [x] 2.1 创建 `src/tui/components/TeamTopology.tsx`：定义 `TeamTopologyProps` 接口（`members: MemberState[]`、`tasks: TaskState[]`、`activeMemberName: string | null`），实现可见性门控（`agentMode !== "team" || members.length === 0` 时 `return null`）—— 注：agentMode 不需作为 prop，App.tsx 控制是否渲染
- [x] 2.2 实现树形结构渲染：leader 根节点（`★ leader` 或 `★ ▶ leader` 高亮），member 子节点用 `├─ ` / `└─ ` 连线字符；最后一个 member 用 `└─ `，其他用 `├─ `
- [x] 2.3 实现节点信息行：`{treeConnector}{▶?}{statusIcon} {name}/{role}`，name 在 active 时用 `colors.primary`，非 active 用 `colors.textMuted`；status 图标用 `teamStatusIcon` + `teamStatusColor`
- [x] 2.4 实现 task 段拼接：当 `member.currentTaskId` 非 null 且能在 `tasks` prop 中找到对应 task 时，追加 ` · {taskId}: {taskTitle}`；找不到时省略
- [x] 2.5 实现文本截断：基于 `process.stdout.columns` 计算 maxWidth（兜底 undefined/null/0 → 80），公式 `effective - paddingLeft(2) - paddingRight(2) - treeIndent(4)`，超出时 `slice(0, maxWidth-1) + "…"`；将截断函数提取为独立的纯函数 helper（供 unit test）
- [x] 2.6 实现 resize 监听：用 `useEffect` 订阅 `process.stdout.on("resize", ...)`，触发 `setResizeCounter(c => c+1)` 强制重算 maxWidth；卸载时 `off("resize", ...)` 防泄漏
- [x] 2.7 用 `<scrollbox maxHeight={10} scrollY>` 包裹树状内容，外部用 paddingLeft/paddingRight 各 2 的 `<box flexShrink={0}>` 包裹
- [x] 2.8 运行 `bun run check` 确认 TeamTopology 编译通过（512 pass / 0 fail）

## 3. App.tsx 集成

- [x] 3.1 在 `src/tui/App.tsx` 顶部导入 `TeamTopology`
- [x] 3.2 在底部组合 box 内（InputBox 与 StatusBar 之间）插入 `<TeamTopology members={members} tasks={client.listTasks()} activeMemberName={activeMemberName} />`
- [x] 3.3 用 `agentMode === "team"` 条件包裹（或让组件内部 return null 处理），确保 non-team 模式下不渲染
- [x] 3.4 运行 `bun run check` 确认集成无类型/lint 错误（512 pass / 0 fail）

## 4. StatusBar 改造：移除 member tags

- [x] 4.1 修改 `src/tui/components/StatusBar.tsx`：删除 `showMembers` 块（约第 68-100 行的 leader tag + member map 渲染逻辑）
- [x] 4.2 删除 StatusBar 中不再需要的 import 和函数：移除 `MemberState` 导入、`statusIcon` 导入、`memberStatusColor` 函数、`agentMode` 相关逻辑
- [x] 4.3 修改 `StatusBarProps` 接口：移除 `members`、`activeMemberName`、`agentMode` 字段（保留 mode、context*、copyFeedback）
- [x] 4.4 修改 `src/tui/App.tsx` 中 `<StatusBar />` 调用：移除 `members`、`activeMemberName`、`agentMode` props 传递
- [x] 4.5 运行 `bun run check` 确认 StatusBar 改造无类型错误（512 pass / 0 fail）

## 5. 清理孤儿组件

- [x] 5.1 全局 grep 确认 `MemberTags` 不再被任何文件引用（StatusBar 改造完成后应已无引用）
- [x] 5.2 删除 `src/tui/components/MemberTags.tsx`
- [x] 5.3 运行 `bun run check` 确认删除后无断链错误（512 pass / 0 fail）

## 6. 测试与验证

- [x] 6.1 为 `theme.ts` 中新增的 `teamStatusIcon` / `teamStatusColor` 写 unit test（覆盖 6 种 status 返回值），放入 `tests/theme-team-status.test.ts`
- [x] 6.2 为 `TeamTopology` 的文本截断逻辑写纯函数 unit test（覆盖正常、超长、终端宽度 undefined 三种情况），把截断函数提取为可独立测试的导出 helper
- [x] 6.3 运行 `bun run check`（typecheck + lint + test）确认全绿（539 pass / 0 fail / +27 new tests）
- [ ] 6.4 手动启动 TUI（`bun run dev`）验证：team 模式 + 多成员下拓扑图正确渲染在 InputBox 与 StatusBar 之间，StatusBar 不再有 member tags，`[` / `]` 切换时拓扑图节点高亮正确联动 — **留待用户验收阶段执行**
