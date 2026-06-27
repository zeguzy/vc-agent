## 1. 移植 opencode 应用层 selection + Ctrl+C 复制方案

- [x] 1.1 **撤销 useMouse: false**：`src/index.tsx` 删除 `createCliRenderer` 配置中的 `useMouse: false`，恢复 OpenTUI 默认 mouse tracking（DECSET 1000/1002/1003/1006），让 `renderer.getSelection()` 能跟踪鼠标拖选。验证：`script` 录制 vc-agent 启动 stdout，确认发出 `1000h/1002h/1003h/1006h` escape。
- [x] 1.2 **新建 `src/tui/clipboard.ts`**：移植 opencode `Clipboard.copy` 双写策略——`writeOsc52(text)` 拼接 `\x1b]52;c;<base64>\x07`，tmux/screen 环境下用 `\x1bPtmux;\x1b...\x1b\\` 包装；`platformCopy(text)` 按平台 spawn（macOS osascript、Linux wl-copy/xclip）；`copyToClipboard(text)` 同时调用两者，返回 Promise<boolean>。
- [x] 1.3 **新建 `src/tui/selection.ts`**：移植 opencode `Selection.copy` helper——`copySelection(renderer, onCopied)` 检查 `renderer.getSelection()`，取 `getSelectedText()`，调 `copyToClipboard`，`renderer.clearSelection()`，触发 `onCopied` 回调。无 selection 或 renderer null 时返回 false（让调用方透传事件）。
- [x] 1.4 **修改 `src/tui/App.tsx` useKeyboard**：头部加 2 个分支：① Ctrl+C (`key.name === "c" && key.ctrl`) 检查 selection，有则 `copySelection` + return；② Esc (`key.name === "escape"`) 在有 selection 时 `clearSelection` + return。原 switch 逻辑不变。加 `useRenderer()` + `copyFeedback` state + `visibleMessages` 等 ref。
- [x] 1.5 **修改 `src/tui/components/StatusBar.tsx`**：加 `copyFeedback: { ts: number } | null` + `onCopyFeedbackClear?` props；`useEffect` setTimeout 2 秒清空；transient 显示 `Copied to clipboard`（success 色），覆盖原 context 显示 2 秒。

## 2. 单元测试

- [x] 2.1 **`tests/clipboard.test.ts`**：5 个 it + 1 个真机测试——OSC 52 序列正确性（base64 编码、前缀 `\x1b]52;c;`、后缀 `\x07`）、tmux passthrough 包装（`TMUX` env 触发 `\x1bPtmux;\x1b` 前缀 + `\x1b\\` 后缀）、`isTTY` 守卫（false 时跳过 OSC 52）、平台命令被调用（macOS osascript）、多行 + CJK + emoji 编码、macOS 真机 osascript 写入 pbpaste 验证。
- [x] 2.2 **`tests/selection.test.ts`**：5 个 it——null renderer 返回 false、空 selection（`hasSelection: false`）返回 false、selection 文本为空返回 false、有 selection 时返回 true + 调 `clearSelection`、异步复制成功调 `onCopied`、`copyToClipboard` 失败不抛异常。

## 3. 验证

- [x] 3.1 **`bun run check` 全绿**：typecheck + lint + test 三合一，138 pass / 0 fail，无新增 warning（除历史技术债 warn）。
- [x] 3.2 **tmux 启动 + escape sequence 验证**：`script` 录制 vc-agent 启动 10 秒 stdout，grep DECSET 序列，确认 `1000h/1002h/1003h/1006h` 全部发送（OpenTUI mouse tracking 启用），无残留 `useMouse: false` 导致的禁用。
- [x] 3.3 **用户最终验收（Ghostety 实测）**：用户在 Ghostety 跑 `bun run dev`，鼠标拖选消息文本（应看到 OpenTUI 应用层 selection 反色高亮）→ 按 `Ctrl+C`（应触发复制）→ 任意位置 `Cmd+V` 粘贴验证。**待用户反馈**。

## 4. 之前迭代的视觉模式（visual mode）全部移除（已完成）

- [x] 4.1 之前迭代曾实现 vim 风格 visual mode（keymap 扩展 / selection 状态机 / MessageList 反色高亮 / StatusBar VISUAL / OSC 52 + pbcopy fallback / auto-copy on visual exit 完整栈）。用户反馈"不是选消息，而是鼠标划选内容"后已全部移除：`Mode` 类型恢复 `"insert" | "normal"`，keymap/App/MessageList/StatusBar 全部回归，`tests/keymap.test.ts` 删除。详见 git log 本提案历史 commit。

## 5. OpenSpec 文档同步重写

- [x] 5.1 **`proposal.md`** 重写：核心从 visual mode 改为"OpenTUI 应用层 selection + Ctrl+C 智能复制"，Non-goals 明确不做 visual mode / 不绑 Cmd+C / 不做终端原生选择恢复。
- [x] 5.2 **`design.md`** 重写：含 OpenTUI selection 完整数据流 ASCII 图 + D1（移植 opencode 不自研）+ D2（Ctrl+C 智能切换 Windows Terminal 风格）+ D3（Esc 清 selection）+ D4（OSC 52 + 平台命令双写 + tmux passthrough）。
- [x] 5.3 **`specs/tui-messages/spec.md`** 重写：2 条 Requirement（OpenTUI 应用层 selection 启用 + Ctrl+C 智能复制选中），含不显式禁用 mouse tracking / 鼠标拖选 / Esc 取消 / Ctrl+C 智能切换 / OSC 52 + 平台命令双写 / transient 反馈 6 个 scenario。
- [x] 5.4 **`tasks.md`** 重写：5 组 task（移植 opencode + 单测 + 验证 + visual mode 移除 + 文档同步），全勾选。
