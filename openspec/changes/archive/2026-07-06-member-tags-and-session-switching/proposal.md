## Why

Team mode 当前体验存在断层：输入区和 WorkersView 是割裂的——要看成员状态得打开弹出面板，要查看成员的具体对话内容根本无法做到。用户在 normal 模式下也缺少快捷键来快速在成员子会话之间跳转。这个 change 把成员标签和会话切换整合进主 UI 流，让团队协作更流畅。

## What Changes

- 在输入框下方新增**成员标签行**（仅 team 模式可见），紧凑显示所有成员名称和运行时状态图标
- 新增 normal 模式快捷键 `[` / `]` 在成员子会话之间切换（包括 leader/orchestrator）
- 切换成员时，MessageList 自动切换显示该成员的对话消息
- 在成员子会话视图中输入文字时，消息发送给对应成员（`directMember("directive", ...)`）
- 切换回 leader 时恢复 orchestrator 视图

## Capabilities

### New Capabilities
- `member-sub-session-view`: 查看和切换团队成员子会话，在独立视图中浏览成员的完整对话历史

### Modified Capabilities
- `tui-input`: 输入区新增成员标签行组件，根据团队模式可见/隐藏
- `tui-messages`: 消息列表支持按成员过滤显示（渲染不同 AgentSession 的消息）
- `tui-layout`: 布局新增标签行区域，位于输入区和状态栏之间

## Impact

- `src/tui/keymap.ts`：新增 `[` / `]` 快捷键绑定
- `src/tui/App.tsx`：新增 `activeMemberName` 状态、`handleMemberNav` handler、按成员过滤 messages 逻辑
- `src/tui/components/InputBox.tsx`：接受成员列表和活跃成员 prop，渲染标签行
- 新建 `src/tui/components/MemberTags.tsx`：标签行组件

## Non-goals

- 不改变 WorkersView（`/workers` 面板）的行为
- 不支持在成员视图中直接创建/删除成员
- 不做成员消息的实时流式订阅（V1 在切换时重新加载）
- 不改变 HTTP client 端（仅 in-process 模式支持）
