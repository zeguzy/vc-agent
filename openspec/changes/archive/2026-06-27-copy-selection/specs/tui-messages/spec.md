## ADDED Requirements

### Requirement: OpenTUI 应用层 selection 启用
系统 SHALL 依赖 OpenTUI 默认的 mouse tracking（DECSET 1000/1002/1003/1006）让 `renderer.getSelection()` API 能跟踪用户鼠标拖选，渲染选中区域反色高亮（由 OpenTUI 自动处理）。

#### Scenario: 不显式禁用 mouse tracking
- **WHEN** `src/index.tsx` 调用 `createCliRenderer`
- **THEN** 配置对象 SHALL **不**包含 `useMouse: false`
- **AND** OpenTUI SHALL 按默认行为启用 mouse tracking（向终端发送 `\x1b[?1000h` / `\x1b[?1002h` / `\x1b[?1003h` / `\x1b[?1006h`）

#### Scenario: 鼠标拖选消息文本
- **WHEN** 用户在 vc-agent 运行时鼠标拖动选消息列表中的文本
- **THEN** OpenTUI SHALL 跟踪 selection（应用层 `renderer.getSelection()` 返回非空）
- **AND** 选中区域 SHALL 反色高亮（由 OpenTUI 渲染，不需 vc-agent 处理）

#### Scenario: 取消 selection
- **WHEN** 用户在有 selection 状态下按 `Escape`
- **THEN** 系统 SHALL 调用 `renderer.clearSelection()` 清空选区
- **AND** 此 Esc 事件 SHALL **不**触发 insert→normal 模式切换（专门用于清 selection）
- **AND** 无 selection 时 Esc 维持原行为（insert→normal）

### Requirement: Ctrl+C / Cmd+C 智能复制选中（Windows Terminal + macOS 风格）
系统 SHALL 在 `useKeyboard` 头部拦截 `Ctrl+C`（`key.name === "c" && key.ctrl === true`）或 `Cmd+C`（macOS，`key.name === "c" && key.super === true`），有 selection 时复制并消费事件，无 selection 时透传给原 action。

注：OpenTUI 的 `KeyEvent` 字段中，macOS Cmd 键编码为 `super: true`（跨平台术语，Win 键同字段），不是 `meta: true`（meta 是 ESC/Alt）。

#### Scenario: 有 selection 时 Ctrl+C 或 Cmd+C 触发复制
- **WHEN** `renderer.getSelection()` 返回非空（用户拖选了文本）
- **AND** 用户按 `Ctrl+C` 或 `Cmd+C`（macOS）
- **THEN** 系统 SHALL 调用 `copySelection(renderer, onCopied)`，helper 内部：
  1. 调 `renderer.getSelection().getSelectedText()` 取选中文字
  2. 调 `copyToClipboard(text)`（OSC 52 + 平台命令双写）
  3. 调 `renderer.clearSelection()` 清空选区
  4. 调 `onCopied` 回调（设置 `copyFeedback` state 触发 StatusBar 反馈）
- **AND** 系统 SHALL **不**触发 abort / 双击退出逻辑（事件被消费）

#### Scenario: 无 selection 时 Ctrl+C 透传给 abort，Cmd+C 静默
- **WHEN** `renderer.getSelection()` 返回 null（用户没拖选）
- **AND** 用户按 `Ctrl+C`
- **THEN** 系统 SHALL 透传事件给原 `ctrlC` action（保持 vc-agent 原有行为：单击 abort Agent，双击 1 秒内退出）
- **WHEN** 用户按 `Cmd+C`（无 selection）
- **THEN** 系统 SHALL 静默无操作（不 abort，不退出；Cmd+C 在 vc-agent 语义中是"复制"，无可复制即什么也不做）

#### Scenario: OSC 52 + 平台命令双写剪贴板
- **WHEN** `copyToClipboard(text)` 被调用
- **THEN** 函数 SHALL 同时执行：
  1. **OSC 52 路径**：若 `process.stdout.isTTY` 为 true，拼接 `\x1b]52;c;<base64>\x07` 序列；若 `TMUX` 或 `STY` 环境变量存在，用 `\x1bPtmux;\x1b...\x1b\\` 包装 passthrough；写 `process.stdout`
  2. **平台命令路径**：macOS 用 `osascript -e 'set the clipboard to "<escaped>"'`；Linux + `WAYLAND_DISPLAY` 用 `wl-copy`（stdin 传文本）；Linux + X11 用 `xclip -selection clipboard`（stdin 传文本）
- **AND** 两条路径独立执行，任一失败 SHALL 不影响另一条

#### Scenario: 复制成功 transient 反馈
- **WHEN** `copySelection` 调用 `onCopied` 回调
- **THEN** App SHALL 设置 `copyFeedback = { ts: Date.now() }`
- **AND** StatusBar SHALL 显示 `Copied to clipboard`（`colors.success` 色）2 秒
- **AND** 2 秒后通过 `useEffect + setTimeout` 自动清空 `copyFeedback`，恢复 mode/model/context 显示
