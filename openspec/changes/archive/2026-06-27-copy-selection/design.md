## Context

vc-agent 之前的迭代曾实现过 vim 风格 visual mode（keymap 扩展、selection 状态机、MessageList 反色、OSC 52 + pbcopy fallback、auto-copy on visual exit 完整栈），但用户最终明确反馈"不是选消息，而是鼠标划选内容"——visual mode 基于错误假设，全部移除。

调研 opencode（`packages/opencode/src/cli/cmd/tui/util/{clipboard,selection}.ts` + `app.tsx`）发现 opencode 用 OpenTUI 内建的**应用层 selection** API（`renderer.getSelection()`），完美覆盖"鼠标划选 + 复制"场景，且代码量远小于自研 visual mode。

```
OpenTUI 应用层 selection 流（移植自 opencode）
═══════════════════════════════════════════════════════════

 1. vc-agent 启动
    └─► createCliRenderer (默认 useMouse: true)
        └─► 发 DECSET 1000h / 1002h / 1003h / 1006h
            └─► OpenTUI 接管 mouse event
                └─► 用户鼠标拖动 ──► OpenTUI 跟踪 selection
                                      │
                                      ▼
                              渲染选中区域反色高亮
                              （由 OpenTUI 自动处理）

 2. 用户按 Ctrl+C
    └─► App.tsx useKeyboard 头部拦截
        │
        ├─ renderer.getSelection() 非空?
        │   ├─ YES ─► copySelection(renderer, onCopied) ──► return
        │   │           │
        │   │           ├─ sel.getSelectedText()
        │   │           ├─ copyToClipboard(text)
        │   │           │   ├─ writeOsc52(text) ──► stdout ──► 终端 OSC 52
        │   │           │   └─ platformCopy(text)
        │   │           │       ├─ macOS: osascript "set the clipboard to"
        │   │           │       ├─ Linux+Wayland: wl-copy
        │   │           │       └─ Linux+X11: xclip -selection clipboard
        │   │           ├─ renderer.clearSelection()
        │   │           └─ onCopied() ──► setCopyFeedback({ts})
        │   │                              │
        │   │                              ▼
        │   │                  StatusBar 显示 "Copied to clipboard" 2 秒
        │   │
        │   └─ NO ─► 透传给原 ctrlC abort handler（双击退出逻辑不变）
        │
        └─► 用户按 Esc
            └─► renderer.getSelection() 非空 ─► clearSelection（取消选中）

═══════════════════════════════════════════════════════════
```

## Goals / Non-Goals

**Goals:**
- 让用户在 vc-agent 消息列表中能用鼠标拖选任意文本（OpenTUI 应用层 selection）
- 按 `Ctrl+C` 复制选区到系统剪贴板（OSC 52 + 平台命令双写，覆盖 SSH 远程 / 本地 / tmux）
- 与 opencode 实现完全对齐（移植而非自研）

**Non-Goals:**
- vim 风格 visual mode / 自研 selection 状态机
- `Cmd+C` 绑定（macOS 终端拦截不可靠）
- 终端原生选择恢复（OpenTUI 应用层 selection 已覆盖需求）
- 字符粒度以外的 selection 模式（行级 / 块级）

## Decisions

### D1: 移植 opencode 完整方案，不自研

**选择**：完整移植 opencode `Selection.copy` + `Clipboard.copy` + `useKeyboard` Ctrl+C 智能切换逻辑到 vc-agent。

**理由**：
- opencode 是 OpenTUI 团队亲做的代码助手，剪贴板方案经过生产验证
- OpenTUI 的 `renderer.getSelection()` API 是 OpenTUI 官方提供，与自研 visual mode 相比代码量少一个数量级
- vc-agent 与 opencode 同用 `@opentui/react`，移植成本最低
- 双写策略（OSC 52 + 平台命令）覆盖 SSH 远程 / 本地 / tmux 全部场景，单独任何一个都不够

**备选（已否决）**：
- 自研 vim visual mode（之前迭代版本，~300 行）→ 用户反馈"只要鼠标"，多余
- 仅 OSC 52（最初版本）→ macOS Terminal.app / iTerm 默认禁用 OSC 52，本地不可用
- 仅平台命令 → SSH 远程不可用（服务端无 pbcopy）
- 依赖终端原生选择（中间版本）→ OpenTUI 启用 mouse tracking 后屏蔽终端原生选择，矛盾

### D2: Ctrl+C 智能切换（Windows Terminal 风格）

**选择**：在 `useKeyboard` 头部拦截 `Ctrl+C`，有 selection 时复制并 return；无 selection 时透传给原 `ctrlC` action（abort / 双击退出）。

**理由**：
- opencode 的成熟模式，与 Windows Terminal / Alacritty / WezTerm 等"现代"终端行为一致
- 用户肌肉记忆：Ctrl+C 在 TUI 里通常 = abort，但选中时 = 复制（与 GUI 应用一致）
- vc-agent 原 `ctrlC` action（abort + 双击退出）保持不变，仅在 selection 存在时短路
- 不与 macOS Cmd+C 冲突（Cmd+C 被终端拦截，根本到不了应用）

### D3: Esc 清空 selection（与 opencode 一致）

**选择**：Esc 在有 selection 时清空 selection 并 return（不再触发 insert→normal 模式切换）；无 selection 时维持原行为（insert→normal）。

**理由**：
- opencode 的模式：用户选错了想取消，按 Esc 干净
- 与 Ctrl+C（复制并清）形成对照：Ctrl+C 接受，Esc 拒绝

### D4: 双写剪贴板（OSC 52 + 平台命令）

**选择**：每次复制同时执行 OSC 52（写 stdout）+ 平台命令（spawn），不依赖任何一方返回值。

**理由**：
- OSC 52 覆盖 SSH 远程：服务端不需要装 pbcopy，靠客户端终端模拟器处理
- 平台命令覆盖本地 macOS / Linux 桌面：弥补 macOS Terminal.app / iTerm 默认禁 OSC 52
- 双写不冲突：两个目标剪贴板可能不同（SSH 客户端 vs 服务端桌面），都更新无副作用
- opencode 的同款策略，生产验证

**tmux passthrough 包装**：在 tmux 内运行时，OSC 52 序列需用 `\x1bPtmux;\x1b...\x1b\\` 包装才能转发给外层终端。通过 `process.env.TMUX` / `process.env.STY` 检测。

**平台命令映射**：
- macOS：`osascript -e 'set the clipboard to "..."'`（比 `pbcopy` 更可靠，opencode 选择）
- Linux+Wayland：`wl-copy`（stdin 传文本）
- Linux+X11：`xclip -selection clipboard`（stdin 传文本）
- Windows：通过 PowerShell `Set-Clipboard`（vc-agent 当前不主推 Windows，作为预留）

## Risks / Trade-offs

- **[Ctrl+C 与 abort 的快捷键复用]** 用户可能在 selection 残留时按 Ctrl+C 期望 abort，实际触发复制。
  → **缓解**：复制后立即 `clearSelection`，下次 Ctrl+C 必然走 abort。selection 残留场景：用户拖选后改主意，先按 Esc 清，再 Ctrl+C abort——这是 Windows Terminal 用户的标准习惯，可接受。

- **[OpenTUI 应用层 selection 在某些终端渲染异常]** OpenTUI 用 SGR mouse mode（1006h）+ 应用层渲染 selection 反色，理论上所有支持 SGR mouse 的终端都能工作，但旧版本终端可能渲染异常。
  → **缓解**：现代终端（iTerm2 / Ghostety / kitty / WezTerm / Alacritty / Windows Terminal）均支持 SGR mouse。少数不支持的用户可改用 vim 风格（本提案 Non-goals，未来可加）。

- **[macOS osascript 复制延迟]** `osascript` 通过 AppleScript 设置剪贴板，相比 `pbcopy` 略慢（~30-50ms）。
  → **缓解**：异步执行（`copyToClipboard` 返回 Promise），不阻塞 UI；opencode 选 osascript 是因为某些环境 `pbcopy` 不可用（如 sandboxed），可靠性优先于速度。

- **[tmux 内复制到外层终端剪贴板依赖 tmux 配置]** tmux 内 OSC 52 序列需 tmux 转发，要求 `set-clipboard = external`（tmux 3.2+ 默认）。
  → **缓解**：平台命令（osascript/pbcopy）会写服务端剪贴板，与 OSC 52 写客户端剪贴板互补。tmux 用户在 SSH 场景下若 `set-clipboard` 配置不对，至少服务端剪贴板有内容（用 SSH 客户端的 clipboard 同步工具拉取）。
