## Why

vc-agent TUI 缺少"复制消息文本到剪贴板"的能力。用户用 Agent 写代码时，复制回复中的代码块、命令、文件路径是高频操作，但 vc-agent 默认行为下用户既无法用鼠标选中消息文本，也没有任何快捷键能复制选区到系统剪贴板。

参考 opencode 的成熟方案：opencode 用 OpenTUI 的**应用层 selection**（`renderer.getSelection()` API）+ **Ctrl+C 智能切换**（Windows Terminal 风格：有 selection 时复制，无则透传 abort）+ **OSC 52 + 平台命令双写剪贴板**。本提案完整移植此方案到 vc-agent。

## What Changes

- **新建 `src/tui/clipboard.ts`**：移植 opencode 的 `Clipboard.copy` 双策略——OSC 52 escape（带 tmux passthrough 包装）写 stdout + 平台命令（macOS `osascript`、Linux `wl-copy`/`xclip`、Windows PowerShell）spawn 写系统剪贴板，两者同时执行，覆盖 SSH 远程 / 本地 / tmux 全部场景。
- **新建 `src/tui/selection.ts`**：移植 opencode 的 `Selection.copy` helper——`copySelection(renderer, onCopied)` 从 `renderer.getSelection().getSelectedText()` 取文本，调 `copyToClipboard`，`renderer.clearSelection()` 清空选区。
- **修改 `src/tui/App.tsx`**：`useKeyboard` 头部加 Ctrl+C 智能切换分支（有 selection → `copySelection` 复制 + return；无 selection → 透传给原有 `ctrlC` abort 逻辑）；加 Esc 在有 selection 时清空 selection（覆盖各 mode）；新增 `copyFeedback` state；用 `useRenderer()` 拿 renderer；传 `copyFeedback` / `onCopyFeedbackClear` 给 StatusBar。
- **修改 `src/tui/components/StatusBar.tsx`**：加 `copyFeedback` prop，transient 显示 `Copied to clipboard`（success 色）2 秒后自动清。
- **依赖 OpenTUI 默认行为**：`createCliRenderer` 默认 `useMouse: true`，自动启用 mouse tracking（DECSET 1000/1002/1003/1006）让 OpenTUI 跟踪应用层 selection——vc-agent 不需要显式配置。

## Non-goals

- **不做**vim 风格 visual mode（之前迭代版本实现过，用户反馈"不是选消息，而是鼠标划选内容"——OpenTUI 应用层 selection 完全覆盖此场景，多余）
- **不做**`Cmd+C` 绑定——macOS Terminal.app / iTerm2 / Ghostety 默认拦截 Cmd+C 不传给应用，opencode 用 `Ctrl+C`，本提案保持一致
- **不做**字符级 / 行级 visual 选择（OpenTUI selection 是字符粒度，比 vim linewise 更精细）
- **不做**OSC 53 / paste 反向读取剪贴板（仅复制方向）
- **不做**终端模拟器配置指引（如 Ghostety `mouse-reporting = false`）——文档说明即可

## Capabilities

### New Capabilities
<!-- 不引入新 capability，所有改动收敛在 tui-messages 下 -->

### Modified Capabilities
- `tui-messages`: 新增「OpenTUI 应用层 selection」与「Ctrl+C 智能复制选中」两条 requirement，覆盖：mouse tracking 默认启用让 OpenTUI 跟踪鼠标拖选、Ctrl+C 在有 selection 时复制 / 无 selection 时透传 abort、Esc 清空 selection、OSC 52 + 平台命令双写剪贴板、StatusBar transient 复制成功反馈。

## Impact

- **代码**：
  - `src/tui/clipboard.ts`：新增（~50 行）
  - `src/tui/selection.ts`：新增（~30 行）
  - `src/tui/App.tsx`：useKeyboard 头部加 2 个分支 + 新 state + useRenderer
  - `src/tui/components/StatusBar.tsx`：加 copyFeedback transient 显示
  - `src/index.tsx`：零改动（不显式 `useMouse: false`，依赖默认）
- **依赖**：无新增（OSC 52 是 stdout 字节序列，平台命令用 `node:child_process` 内置）
- **运行时**：用户鼠标拖选消息文本（OpenTUI 应用层 selection 反色高亮）→ Ctrl+C → StatusBar 显示 `Copied to clipboard` → 任意位置 Cmd+V 粘贴
- **测试**：`tests/clipboard.test.ts`（OSC 52 编码 / tmux passthrough / isTTY 守卫 / macOS osascript 真机）+ `tests/selection.test.ts`（null renderer / 空 selection / 有 selection / 异常路径）
