## Why

openagent 当前在执行长任务（bash、agent 多轮思考）时，用户只能盯着 TUI 等待。一旦切窗口去做别的事，就无法知道「agent 已经完成」「工具失败了」「agent 在等我回答问题」。这类「需要用户注意」的瞬间被静默吞掉，导致：(1) 浪费用户切换上下文的时间；(2) agent 阻塞在 `question` 工具上无人响应；(3) 长任务跑完后用户迟迟不回来。

终端编码助手的核心痛点之一就是「异步等待」—— 原生通知（OS Notification Center / 终端 OSC 通知 / TUI 内 Toast）是解决这一痛点的标准答案，且在 Claude Code、Cursor 等同类产品中已成为标配。

## What Changes

- **新增通知模块**：三层级联投递 —— ① OpenTUI `renderer.triggerNotification()`（OSC 99/9，iTerm2/Ghostty/WezTerm 原生支持）→ ② 平台二进制（macOS `terminal-notifier` 优先、`osascript` 兜底；Linux `notify-send`；Windows `SnoreToast`）→ ③ headless/SSH 守卫静默 no-op。
- **新增 TUI Toast 组件**：TUI 运行时在场反馈，复用 `StatusBar.tsx` 的 `copyFeedback` 超时模式；与 OS 通知智能共存（见 design.md）。
- **新增配置块 `notifications`**：全局开关 + 按事件类型开关 + 通道开关（OSC / OS / Toast）。
- **接入事件总线**：在 `AgentServer.ensureSubscribed()`（`src/server/index.ts:53`）注册独立订阅者，覆盖 TUI / headless run / serve+attach 全部运行模式。
- **覆盖事件**（默认全开）：`agent_end`（一轮完成）、`tool_execution_end` + `isError`（工具失败）、`question` tool 阻塞（`tools/question.ts:58`）、长时 bash 完成（`toolName === "bash"` 且耗时 ≥ 阈值）、`compaction_end`（压缩完成）。
- **headless/SSH 守卫**：检测 `SSH_CONNECTION`、Linux `DISPLAY`/`WAYLAND_DISPLAY` 缺失、D-Bus socket 缺失等，无 GUI 时静默 no-op，绝不抛错。

## Non-goals

- **不做通知点击回调**：v1 不处理「点击通知聚焦终端」的反向通道（OSC 路径天然支持但回调链复杂，留 v2）。
- **不 vendor 二进制**：不内置 `terminal-notifier` / `SnoreToast` 等可执行文件；运行时探测 `$PATH`，缺失则降级。避免仓库膨胀与平台签名问题。
- **不做通知去重 / 队列 / 历史**：v1 仅「事件 → 即时通知」，不做频率限制或聚合。
- **不做声音自定义**：沿用各通道默认提示音（`osascript` 的 `sound name "Glass"`、`notify-send` 的 urgency），不暴露 sound 配置。
- **不做 Windows 一等公民支持**：Windows 走 SnoreToast/PowerShell 兜底，不保证零配置；macOS / Linux 是 v1 验证重点。
- **不做 TUI 失焦检测**：终端无法可靠知道窗口是否前台；v1 采用「TUI Toast 总显示 + OS 通知按事件类型选择性触发」的并存策略（详见 design.md）。
- **不引入 `node-notifier` 依赖**：其 vendor 的 `terminal-notifier@1.7.2`（2017 年）比 Homebrew 还旧，继承 `-sender` 挂起、`-appIcon` 失效等问题；直接用 `Bun.spawn` 调系统二进制更干净。

## Capabilities

### New Capabilities

- `notifications`: 端到端通知能力 —— 事件订阅、通道选择（OSC/OS/Toast）、平台降级、headless 守卫、配置开关。

### Modified Capabilities

- `settings`: 新增 `notifications` 配置块（`enabled` / 事件开关 / 通道开关 / bash 阈值），纳入现有 `~/.config/openagent/config.json` + `<cwd>/.openagent/config.json` 合并体系。

## Impact

- **新增代码**：
  - `src/notifications/`（新模块）：`types.ts`（事件→通知映射）、`channels.ts`（OSC/OS/Toast 三通道）、`guard.ts`（headless 检测）、`notifier.ts`（编排）、`config.ts`（默认配置）。
  - `src/tui/components/Toast.tsx`（新组件）+ `src/tui/hooks/useToasts.ts`。
- **修改代码**：
  - `src/config.ts`：`Config` 接口新增 `notifications?: NotificationsConfig`。
  - `src/server/index.ts`：`ensureSubscribed()` 内追加通知订阅者。
  - `src/tui/App.tsx`：挂载 `<Toast>` overlay + 注入 toast 通道。
  - `src/tools/question.ts`：在 Promise await 处触发「需要输入」通知。
  - `src/headless/runner.ts`：复用同一 notifier（已通过 server 订阅自动覆盖，仅需验证）。
- **依赖**：不新增 npm 依赖（全部 `Bun.spawn` 系统/Brew 二进制）。
- **配置兼容**：`notifications` 块整体可选，缺失时走默认值（全开），老配置零改动。
- **测试**：新增 `tests/notifications.test.ts`（通道选择、降级、headless 守卫、配置合并）。
