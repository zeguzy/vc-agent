## Context

团队模式当前的成员可视化散落在两处：

```
┌─ MessageList (消息流，flexGrow) ─────────────────────┐
│                                                       │
└───────────────────────────────────────────────────────┘
┌─ InputBox ────────────────────────────────────────────┐
│ ⠹ Working...                          ← spinner 行    │
│ ┌─ MemberCard (仅 activeMemberName != null 时) ─┐     │ ← 聚焦详情
│ │ ◌ alice · researcher · T1: search api         │     │
│ └────────────────────────────────────────────────┘     │
│ team · gpt-4o · ~/proj · main         ← cwd 状态行    │
│ ┌─ Textarea (圆角边框) ────────────────────────────┐  │
│ │ > _                                               │  │
│ └───────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────┘
┌─ StatusBar ───────────────────────────────────────────┐
│ -- INSERT -- ★leader · ◌alice · ◌bob · ○carol  42%(%)│ ← member tags 在这里
└───────────────────────────────────────────────────────┘
```

**问题**：StatusBar 底部的 member tags 把所有人挤成一行，看不出 role/task/关系；成员超过 3 个时几乎不可读。MemberTags.tsx 是孤儿组件（其布局能力未被使用，仅 `statusIcon` 被 StatusBar 间接复用）。

**架构现实**：底层是 hub-and-spoke 星型拓扑——leader 创建并管理所有 member，member 之间无直接通信（`directMember` 只能从 leader 调用），MemberState 没有 parentId 字段。这让"树状图"成为最自然的可视化形态。

## Goals / Non-Goals

**Goals:**
- 在 InputBox 与 StatusBar 之间插入一个**树状拓扑图**组件，leader 为根、member 为子节点
- 每个节点显示 name + status 图标 + role + current task，让团队工作分配一眼可读
- 高亮当前 active member（拓扑图节点 + `▶` 标记）
- 移除 StatusBar 底部的扁平 member tags，让 StatusBar 回归 mode + context 用量的纯粹职责
- 统一散落在 3 处的 `statusIcon` 副本

**Non-Goals:**
- 不引入 member-to-member 通信或子成员嵌套（架构现实是单层 star）
- 不做交互式拓扑操作（点击节点、右键菜单）
- 不重做 MemberCard（聚焦详情）或 WorkersView（`/members` 全屏面板）
- 不引入动画或新的渲染节流策略

## Decisions

### 决策 1：拓扑图位置——独立组件，而非内嵌 InputBox

**选择**：在 `App.tsx` 的底部组合 box 内，InputBox 之后、StatusBar 之前插入独立 `<TeamTopology />` 兄弟节点。

**理由**：
- InputBox 内部已包含 spinner + MemberCard + cwd 行 + Textarea，再塞拓扑图会让 InputBox 职责过载
- StatusBar 移除 member tags 后回归纯粹状态栏职责
- 独立组件便于单独控制可见性、高度、未来扩展

**备选方案（否决）**：
- A. 内嵌 InputBox 顶部：违反 InputBox 单一职责（输入框组件）
- B. 内嵌 StatusBar：StatusBar 是 `height={1}` 单行设计，拓扑图天然多行
- C. 浮动 overlay：会遮挡消息流，违背"非侵入式信息展示"

### 决策 2：树状渲染形态——纵向树，leader 在顶

**选择**：固定纵向布局，leader 是根节点（第 1 行），member 是子节点（依次向下），使用 `├─` / `└─` / `│` 方框连线字符。

**渲染示例**（4 个成员）：
```
★ leader
├─ ◌ alice/researcher · T1: search api docs
├─ ◌ bob/engineer · T2: implement login
├─ ⏸ carol/reviewer · paused
└─ ○ dave/qa · idle
```

**节点结构**：`{statusIcon} {name}/{role} · {task id}: {task title}` —— 单行紧凑；无 task 时省略 `· {task}` 段。

**理由**：
- 与现有 MemberTags（横向平铺）形成对比，纵向树天然适合表达"一对多"关系
- 用户在澄清问题中明确选择"树状图"而非"1 行紧凑"
- 方框连线字符（`├─` `└─` `│`）在所有终端都能正确渲染，Unicode box-drawing 广义支持

**备选方案（否决）**：
- A. 横向辐射图（leader 左、member 右）：宽度受限，member name/role 长度不一致时对齐困难
- B. 多行 ASCII art（leader 顶部居中、member 下方一排、`│` `┌─┴─┐` 连线）：占 3+ 行，性价比低
- C. 缩进树（无连线字符）：失去"图"的视觉感

### 决策 3：可见性条件——仅 team 模式 + members 非空

**选择**：
```
if (agentMode !== "team" || members.length === 0) return null;
```

**理由**：
- standard/planner/orchestrator 模式没有成员概念
- team 模式但成员列表空（用户尚未创建任何 member）时显示空拓扑图无意义
- `return null` 让组件在 flex 布局中不占空间，三区域结构不受影响

### 决策 4：高度兜底——maxHeight scrollbox，默认不滚动

**选择**：用 `<scrollbox maxHeight={10}>` 包裹树状内容。

**理由**：
- 默认 `maxWorkers=4`，leader + 4 member = 5 行，远低于 10
- 极端情况（用户调高 `maxWorkers`）需要兜底防止拓扑图吃掉 MessageList 所有空间
- scrollbox 在内容 < maxHeight 时表现等同普通 box，不引入视觉差异

**备选方案（否决）**：
- A. 硬截断 `members.slice(0, 6)` + `... and N more`：丢失信息，看不出全部状态
- B. 折叠/展开快捷键：增加交互复杂度，违反 Non-goal

### 决策 5：文本截断——运行时按 stdout.columns 计算

**选择**：在组件内用 `process.stdout.columns`（fallback 80，同时兜底 0 值）计算每行最大宽度，超出则 `slice(0, max-1) + "…"`。

**计算公式**：
```
const cols = process.stdout.columns;
const effective = cols && cols > 0 ? cols : 80;  // 兜底 undefined / null / 0
maxWidth = effective - paddingLeft(2) - paddingRight(2) - treeIndent(4)
```

**Resize 与零值兜底**（Oracle 评审补充）：
- TeamTopology 内用 `useEffect` 订阅 `process.stdout.on("resize", ...)`，触发 `setResizeCounter(c => c + 1)` 强制重新计算 maxWidth 并 re-render。卸载时 `off("resize", ...)` 防止泄漏。
- `process.stdout.columns === 0`（serve+attach 模式或 PTY 初始化阶段可能出现）SHALL 触发 fallback 80，避免 maxWidth 计算为负数导致 `slice(0, -N)` 产生异常字符串。
- resize 事件订阅不影响 `<InputBox>`（其 `<textarea>` 用 `wrapMode="word"` 自动换行，与 TeamTopology 的手算截断是独立路径）。

**理由**：
- OpenTUI 的 `<text>` 不自动按字符裁剪长字符串（会换行或溢出）
- role + task title 组合可能很长（如 "implement the new authentication flow with OAuth2"）
- 运行时计算保证不同终端宽度下都不溢出
- resize 订阅确保用户调整窗口后截断宽度实时更新（首次渲染 + resize 事件双路径）

**备选方案（否决）**：
- A. 固定截断（如 60 字符）：宽终端浪费空间，窄终端仍溢出
- B. 用 OpenTUI `<text width={N}>`：实测对带 ANSI 颜色的文本裁剪不稳定

### 决策 6：active member 高亮——`▶` 前缀 + primary 色

**选择**：
- active 节点（包括 leader 当 `activeMemberName === null` 时）：行首加 `▶ `，name 用 `colors.primary`
- 非 active 节点：行首无 `▶`（保持树形字符 `├─` / `└─`），name 用 `colors.textMuted`

**理由**：
- 与现有 MemberCard、WorkersView 的 `▶` 高亮约定一致
- 树形连线字符 `├─` 保留，`▶` 紧跟其后，不破坏树结构视觉

### 决策 7：statusIcon 统一到 `src/tui/utils/theme.ts`

**选择**：把 `statusIcon(status)` 和 `statusColor(status)` 提取到 `theme.ts`，删除 3 处本地副本（MemberTags、WorkersView、MemberCard）和 StatusBar 内的 `memberStatusColor`。

**理由**：
- 现状是 4 个文件各自定义同名函数，逻辑完全一致——典型重复代码
- 删除 MemberTags.tsx 后，StatusBar 失去 statusIcon 来源，必须迁移
- theme.ts 已是颜色/图标 central source（已有 `colors` 和 `icons`），扩展 `teamStatusIcon` / `teamStatusColor` 命名空间自然

### 决策 8：StatusBar 改造——保留结构，移除 member 块

**选择**：
- 删除 StatusBar.tsx 第 68-100 行的 `showMembers` 块（leader tag + member map）
- 删除 `members` / `activeMemberName` props（以及 `memberStatusColor` 函数）
- 删除 `agentMode` prop（不再需要判断 team 模式）
- StatusBar 仅保留：mode 标识 + copyFeedback + context 用量

**理由**：
- 拓扑图接管了成员可视化职责，StatusBar 重复显示是冗余
- 移除后 StatusBar 回归 spec 描述的"模式指示 + 模型 + 上下文用量"纯粹职责
- 简化 props 接口，减少 App.tsx 调用负担

## Risks / Trade-offs

| 风险 | 缓解 |
|------|------|
| 多成员时拓扑图挤压 MessageList 可视区域 | maxHeight=10 + scrollbox 兜底；maxWorkers 默认 4 实际影响 5 行 |
| 终端窄宽度下 role/task 文本溢出 | 决策 5 的运行时截断策略，按 stdout.columns 动态计算 |
| StatusBar 移除 member tags 后，`[` / `]` 切换成员的视觉反馈完全依赖拓扑图 | 拓扑图节点高亮（决策 6）+ MemberCard 聚焦详情卡仍在 InputBox 内，双重反馈 |
| statusIcon 迁移可能引入回归（4 处副本逻辑看似一致，实际可能有细微差异） | 迁移时逐字对比 4 处实现；加 unit test 覆盖 6 种 status；`bun run check` 兜底 |
| MemberTags.tsx 删除后，若有外部引用未清理会编译失败 | codegraph 已确认仅 StatusBar 间接通过 statusIcon 引用；删除前 grep 兜底 |
| scrollbox 在 maxHeight 未触发时可能引入意外滚动行为 | OpenTUI scrollbox 在内容 ≤ maxHeight 时不显示滚动条，行为等同 box；测试验证 |

## Migration Plan

无运行时迁移（纯 TUI 改动，无数据/配置/API 变更）。变更完全在 worktree 内合并即生效。

**回滚策略**：`git revert <merge-commit>` 即可，无副作用。

## Open Questions

无——所有关键决策（位置、形态、可见性、高度兜底、截断、高亮、statusIcon 迁移、StatusBar 改造）已在本设计内闭环。实施阶段如发现 OpenTUI scrollbox 在 maxHeight 边界的行为与预期不符，可回退到普通 `<box>` + 硬截断方案，无需重新提案。
