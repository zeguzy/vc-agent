## Context

openagent 已有完整的事件总线（`AgentServer.ensureSubscribed()` at `src/server/index.ts:53`），所有 Pi SDK 事件（`agent_end`、`tool_execution_end`、`compaction_end` 等）都从这里扇出到 TUI / headless / HTTP SSE 三个消费端。**事件源已就绪**，缺的只是「把事件转成用户可感知的通知」这一环。

现状缺口：
- 无任何通知组件（OS / TUI Toast 均无）。
- 无 `notifications` 配置块。
- `node-notifier` 未安装，且经调研不应安装（vendor 的 `terminal-notifier@1.7.2` 过旧）。
- 唯一可参考的 transient UI 模式是 `StatusBar.tsx:32-38` 的 `copyFeedback`（2 秒超时）。

约束：
- 运行时：Bun（原生 TS，无编译）。
- 平台优先级：macOS > Linux ≫ Windows。
- 不得新增 npm 依赖（项目风格「不引入新 any、保持轻量」）。
- 配置必须走现有 `~/.config/openagent/config.json` + `<cwd>/.openagent/config.json` deepMerge 体系。
- 设置项必须符合现有 `Setting<T>` 抽象（`src/settings/registry.ts` 注册表）。

## Goals / Non-Goals

**Goals:**
- 用户切离终端时，能在 OS Notification Center 收到「agent 完成 / 工具失败 / 需要输入」通知。
- 用户盯终端时，TUI 内 Toast 提供非阻塞即时反馈。
- macOS 零配置（多数开发者用 iTerm2/Ghostty，OSC 99 直接可用）。
- headless `run` / SSH / 无 GUI 环境下优雅 no-op，绝不抛错。
- 默认开启，用户可在 `/setting` 页面或 config.json 一键关闭。

**Non-Goals:**
- 见 proposal.md「Non-goals」段（通知点击回调、vendor 二进制、去重队列、声音自定义、Windows 一等公民、TUI 失焦检测）。

## Decisions

### D1: 三层级联通道，OSC 优先

```
                    Pi SDK Event
                         │
                         ▼
              ┌─────────────────────┐
              │  NotificationRouter │  ← 读取 config + 运行模式
              └──────────┬──────────┘
                         │
        ┌────────────────┼─────────────────┐
        ▼                ▼                 ▼
   [TUI Toast]      [OSC Channel]     [OS Native]
   TUI 运行时       所有模式              OSC 失败 / headless
   (always)         优先尝试              降级兜底
                         │
                    ┌────┴────┐
                    ▼         ▼
              triggerNoti   spawn 二进制
              fication()    (terminal-notifier /
                            notify-send / osascript)
```

**选择 OSC 优先的理由**：
- 零依赖、零配置：iTerm2/Ghostty/WezTerm/Kitty 原生支持 OSC 99/9。
- 点击通知可聚焦终端（虽然 v1 不处理回调，但 OS 层面已具备）。
- 无权限弹窗、无签名问题。

**降级链**：OSC 返回 `false`（终端不支持或能力未就绪）→ 检测平台 → spawn 系统二进制 → 全部失败则 silent no-op。

**备选方案（已否决）**：
- `node-notifier`：vendor 二进制比 Homebrew 还旧，继承 `-sender` 挂起（julienXX/terminal-notifier#301）、`-appIcon` 失效（#320）等问题。
- 直接 vendor `terminal-notifier-next`（Swift 重写）：v1 不引入二进制，留 v2 评估。

### D2: TUI Toast 与 OS 通知并存（不做失焦检测）

终端无法可靠知道窗口是否前台（OSC focus tracking 需终端支持且不可靠）。v1 策略：

| 运行模式 | TUI Toast | OSC / OS Native |
|---|---|---|
| TUI（`openagent`） | ✅ 总显示（轻量、在场用户受益） | ✅ 按「高价值事件」触发（见 D4） |
| Headless（`openagent run`） | ❌ 无 TUI | ✅ 全事件触发 |
| Server（`openagent serve`） | ❌ 无终端 | ❌ 服务端无用户，不通知 |

**用户可配置**：`channels.toast` / `channels.osc` / `channels.os` 任一关闭。默认全开，TUI 用户若嫌双重通知可在 `/setting` 关闭 OS 通道。

### D3: 订阅点选 `AgentServer.ensureSubscribed()`，而非 `useSessionEvents`

```
Pi SDK AgentSession
   └─ session.subscribe() ──► AgentServer.ensureSubscribed()   ← server/index.ts:53
                                  │  (Set<EventHandler> fan-out)
        ┌─────────────────────────┼──────────────────────────┐
        ▼                         ▼                          ▼
  [新增] NotificationRouter   useSessionEvents(TUI)      HttpClient SSE
   ├─ 覆盖 TUI 模式             (现有，不动)              (现有，不动)
   ├─ 覆盖 headless run
   └─ 覆盖 attach 模式
```

**理由**：单点订阅覆盖全部三种运行模式，符合「process-wide」语义。若挂在 `useSessionEvents` 则只覆盖 TUI，headless 漏通知。

**注意**：NotificationRouter 是 `EventHandler` 之一，与现有 TUI 订阅者并列，互不干扰。

### D4: 事件 → 通知映射（默认全开）

| 事件 | 触发条件 | TUI Toast | OS/OSC | 默认 |
|---|---|---|---|---|
| `agent_end` | 一轮完成 | ✅ | ✅ | 开 |
| `tool_execution_end` | `isError === true` | ✅ | ✅ | 开 |
| `tool_execution_start` + 计时 | `toolName === "bash"` 且耗时 ≥ `bashThresholdMs`（默认 10000） | ❌ | ✅ | 开 |
| `question` tool await | `tools/question.ts:58` Promise 创建时 | ✅ | ✅ | 开（最高价值） |
| `compaction_end` | 压缩完成 | ✅ | ❌ | 开（轻量，不需 OS） |

**bash 阈值机制**：在 `tool_execution_start` 记录开始时间戳，`tool_execution_end` 计算耗时，超阈值才通知。避免 `git status` 这类秒级命令刷屏。

### D5: 配置映射到 `Setting<T>` 抽象

`NotificationsConfig` 是嵌套结构，但现有 `Setting<T>` 抽象面向单值。妥协方案：

- **暴露 3 个顶层 Setting**（在 `/setting` 页面可编辑）：
  - `notifications.enabled`（boolean，总开关）
  - `notifications.sound`（boolean，是否配音）
  - `notifications.bashThresholdSeconds`（number，bash 通知阈值）
- **细粒度事件/通道开关**：仅 config.json 可编辑，`/setting` 不暴露（避免页面爆炸）。

```typescript
interface NotificationsConfig {
  enabled?: boolean;            // 默认 true
  sound?: boolean;              // 默认 true
  bashThresholdMs?: number;     // 默认 10000
  events?: {
    agentEnd?: boolean;         // 默认 true
    toolError?: boolean;        // 默认 true
    longBash?: boolean;         // 默认 true
    needsInput?: boolean;       // 默认 true
    compactionEnd?: boolean;    // 默认 true
  };
  channels?: {
    toast?: boolean;            // 默认 true（仅 TUI 模式）
    osc?: boolean;              // 默认 true
    os?: boolean;               // 默认 true
  };
}
```

### D6: headless / SSH 守卫检测项

```
shouldNotify() =
  NOT (
       env.SSH_CONNECTION                       // SSH 远程，OSC 透传但不发 OS
    OR env.SSH_TTY
  )
  AND (
    platform === "darwin"                       // macOS 总有 Aqua session
    OR (
      platform === "linux"
      AND (env.DISPLAY OR env.WAYLAND_DISPLAY)  // 有图形会话
      AND exists("/run/user/${uid}/bus")        // D-Bus 用户总线
      AND Bun.which("notify-send")              // libnotify 已装
    )
  )
```

**SSH 特殊处理**：SSH 下 OSC 通道仍尝试（序列能透传到本地终端），但 OS 二进制通道 no-op。

**tmux 处理**：不自动检测/修复，仅在文档提示「`set -g allow-passthrough on`（tmux 3.2+）可启用 OSC 透传」。

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| `terminal-notifier -sender` 在 macOS Ventura+ 挂起（julienXX#301） | **绝不传 `-sender`**，仅用基础参数（`-title`/`-message`/`-sound`）。失去「点击聚焦终端」但不挂起。 |
| OSC 能力探测是异步的，启动初期 `renderer.triggerNotification()` 返回 `false` | 接受降级：启动后首条通知可能走 OS 二进制，后续走 OSC。不阻塞。 |
| tmux 默认拦截 OSC 序列 | 文档提示，不自动改用户 tmux 配置。 |
| macOS Tahoe (26.x) 未签名 app 通知权限收紧 | `osascript` 兜底仍可响铃；引导用户在「系统设置 → 通知」授权终端 app。 |
| TUI Toast 与 OS 通知双重打扰 | 默认 TUI 模式下 `compaction_end` 不发 OS；用户可在 `/setting` 关闭 `channels.os`。 |
| `Bun.spawn` 调外部二进制失败（权限/路径） | 全部 `try/catch` + `windowsHide: true`，失败静默，不影响主流程。 |
| 配置嵌套结构与现有 `Setting<T>` 单值抽象不匹配 | 仅暴露 3 个顶层 Setting；细粒度走 config.json（见 D5）。 |
| 硬链接 node_modules 的 worktree 与主 worktree 共享包文件 | 仅开发期临时方案，不进入 git；`bun install` 网络恢复后可重建。 |

## Migration Plan

无破坏性变更，纯新增：
1. 合并后用户首次启动 → `notifications` 块缺失 → 走默认值（全开）→ 立即生效。
2. 老配置文件零改动，无迁移脚本。
3. 想关闭的用户：`/setting` 页面关 `notifications.enabled`，或编辑 config.json。

**回滚**：删除 `src/notifications/`、`src/tui/components/Toast.tsx`，还原 `src/config.ts` / `src/server/index.ts` / `src/tui/App.tsx` / `src/tools/question.ts` 改动即可。无数据迁移，无副作用。

## Open Questions

无（所有关键决策已定）。实施中若发现：
- OpenTUI `triggerNotification` 在当前项目所用版本（`@opentui/core@0.4.1`）API 形态与调研不符 → 现场适配，记录到 tasks。
- `terminal-notifier` 在 `$PATH` 但调用挂起 → 加 3 秒超时（`AbortController` + `setTimeout`），超时降级 `osascript`。
