## Why

团队模式当前的成员可视化过于扁平：StatusBar 底部把 leader 和所有 member 挤成一行 tag（`★leader · ◌alice · ◌bob · ○carol`），看不出谁在做什么、谁向谁汇报，团队成员超过 3 个时几乎不可读。

用户希望在 InputBox（cwd 状态行）和 StatusBar（mode 状态行）之间新增一个真正的**树状拓扑图**区域，以 leader 为根、member 为子节点，每个节点显示 name + status + role + current task，让团队结构和工作分配一眼可读。

底层架构本就是 hub-and-spoke 星型拓扑（leader 创建并管理所有 member，member 之间无直接通信），这让"树状图"成为最自然的可视化形态——一个根节点向下辐射 N 个子节点，无需伪造关系。

## What Changes

- **新增** `TeamTopology` TUI 组件：以 leader 为根节点的树状拓扑图，渲染在 InputBox 与 StatusBar 之间
  - 节点信息：name + status 图标 + role + current task id/标题（截断）
  - 树形连线：使用 `├─` / `└─` / `│` 等方框字符表达父子关系
  - 高亮：active member 节点用 primary 色 + `▶` 标记
  - 仅 team 模式 + members 非空时渲染；其他模式不占空间
- **修改** StatusBar：移除底部 member tags 行（leader + member 列表），让 StatusBar 只承担 mode + context 用量显示
- **修改** `tui-layout` spec 中"成员标签行布局" requirement：标签行不再位于 InputBox 内部，改为 InputBox 与 StatusBar 之间的独立拓扑图区域
- **废弃** 孤儿组件 `MemberTags.tsx`（StatusBar 现状未使用其布局能力，仅复用 `statusIcon`）

## Capabilities

### New Capabilities
- `team-topology-view`: 团队拓扑图组件——以树状结构可视化 leader 与 member 的工作分配与状态

### Modified Capabilities
- `tui-layout`: 移除 InputBox 内部成员标签行布局；新增 InputBox 与 StatusBar 之间拓扑图区域的布局规则
- `member-sub-session-view`: 调整"`[` / `]` 切换成员"和"成员标签行 SHALL 不可见"中涉及标签行的措辞，改为拓扑图节点高亮

## Non-goals

- **不引入 member-to-member 通信或子成员嵌套**：底层架构是单层 hub-and-spoke，拓扑图只反映这一现实，不伪造层级
- **不做交互式拓扑操作**（点击节点切换、右键菜单等）：本变更只做可视化，成员切换仍走 `[` / `]` 快捷键
- **不重做 MemberCard**：InputBox 内聚焦成员时显示的 MemberCard 详情卡保留，与拓扑图（总览）功能互补
- **不做动画/实时刷新优化**：复用现有 `subscribeTeam` 事件订阅机制，不引入新的渲染节流策略
- **不修改 WorkersView**（`/members` 命令打开的全屏成员列表面板）：那是独立的详情视图，本变更不动
- **不支持横向布局**：树状图固定纵向渲染（leader 在顶部，member 在下方一列）

## Impact

- **代码**：
  - 新增 `src/tui/components/TeamTopology.tsx`（约 80-120 行）
  - 修改 `src/tui/components/StatusBar.tsx`（移除 member tags 块，约 -30 行）
  - 修改 `src/tui/App.tsx`（在 InputBox 后插入 `<TeamTopology />`，约 +5 行）
  - 删除 `src/tui/components/MemberTags.tsx`（孤儿组件，约 -75 行；`statusIcon` 迁移到 TeamTopology 或 theme）
  - `src/tui/components/MemberCard.tsx`、`WorkersView.tsx` 中本地 `statusIcon` 副本统一引用
- **Spec**：
  - 新增 `openspec/specs/team-topology-view/spec.md`
  - 修改 `openspec/specs/tui-layout/spec.md`（替换"成员标签行布局" requirement）
  - 修改 `openspec/specs/member-sub-session-view/spec.md`（措辞调整）
- **依赖**：无新增依赖，复用 OpenTUI `<box>` / `<text>` 原语
- **风险**：
  - 多成员时拓扑图高度增长，挤压 MessageList 可视区域（需限制最大高度或可折叠）
  - 终端窄宽度下 role/task 文本可能溢出（需截断策略）
  - StatusBar 移除 member tags 后，`[` / `]` 切换成员的视觉反馈将完全依赖拓扑图高亮
