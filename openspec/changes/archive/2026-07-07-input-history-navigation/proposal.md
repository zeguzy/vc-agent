## Why

用户在终端里反复输入相似或相同命令是高频操作。目前 openagent 的输入框不支持历史消息回溯，用户只能重新手动键入，效率低下。几乎所有主流 Shell（bash/zsh/fish）和 TUI 应用都有 ↑↓ 历史导航，openagent 作为终端助手应当补齐这一基本交互能力。

## What Changes

- 在 INSERT 模式下，当输入框**不在 slash command 模式**时，↑ 键切换到上一条已发送消息，↓ 键切换到下一条已发送消息
- 到达历史边界时（最早/最新消息），光标不再移动，输入框内容保持不变
- 开始浏览历史时，当前正在编辑的草稿会被保存；↓ 到最新消息后再按 ↓，恢复原始草稿
- 浏览历史期间如果用户手动修改了输入内容（键入/删除字符），自动退出历史浏览模式

## Capabilities

### New Capabilities
<!-- None - this is a modification of existing input behavior -->

### Modified Capabilities
- `tui-input`: ↑↓ 键行为扩展 — 当 slash command 建议列表不可见时，↑↓ 键用于历史消息导航而非建议选择

## Impact

- `src/tui/components/InputBox.tsx` — 新增 history 状态管理与 ↑↓ 键处理逻辑
- `src/tui/App.tsx` — 提取已发送的用户消息文本列表，传递给 InputBox
- `openspec/specs/tui-input/spec.md` — 更新 ↑↓ 键行为 spec

## Non-goals

- 不跨会话持久化历史（仅限当前会话内已发送的消息）
- 不支持搜索/过滤历史（如 Ctrl+R）
- 不在 NORMAL 模式支持历史导航（NORMAL 模式已绑定 j/k 用于列表滚动）
