## 1. 基础类型与配置骨架

- [x] 1.1 在 `src/notifications/types.ts` 定义 `NotificationsConfig` 接口（`enabled`/`sound`/`bashThresholdMs`/`events.*`/`channels.*`）、`NotificationEvent` 类型（`agentEnd`/`toolError`/`longBash`/`needsInput`/`compactionEnd`）、`NotificationPayload`（`title`/`message`/`event`）类型
- [x] 1.2 在 `src/notifications/config.ts` 实现 `getDefaultNotificationsConfig()`（全开默认值）、`resolveNotificationsConfig(config?: NotificationsConfig)`（合并默认值与用户配置，处理 `enabled:false` 短路）
- [x] 1.3 在 `src/config.ts` 的 `Config` 接口新增 `notifications?: NotificationsConfig` 字段，从 `src/notifications/types.ts` 导入类型；运行 `bun run typecheck` 确认无破坏

## 2. 通道实现（彼此独立）

- [x] 2.1 在 `src/notifications/channels/osc.ts` 实现 `sendOscNotification(renderer, title, message): boolean`，调用 OpenTUI `renderer.triggerNotification(message, title)`，try/catch 包裹，失败返回 `false`；如当前 `@opentui/core@0.4.1` 的 API 形态与预期不符，现场适配并记录
- [x] 2.2 在 `src/notifications/channels/os-mac.ts` 实现 `sendMacNotification(title, message, sound?): Promise<boolean>`：先用 `Bun.which("terminal-notifier")` 探测，存在则 spawn 调用（**禁止 `-sender` 参数**，仅 `-title`/`-message`/`-sound`），加 3 秒超时（`AbortController`）；缺失或超时则降级 `osascript -e 'display notification'`
- [x] 2.3 在 `src/notifications/channels/os-linux.ts` 实现 `sendLinuxNotification(title, message): Promise<boolean>`：spawn `notify-send --app-name=openagent --urgency=normal --expire-time=8000 title message`，try/catch 失败返回 `false`
- [x] 2.4 在 `src/notifications/channels/os-windows.ts` 实现 `sendWindowsNotification(title, message): Promise<boolean>`：探测 `SnoreToast.exe`，存在则调用，否则 fallback PowerShell `Windows.UI.Notifications`，失败返回 `false`（v1 不重点验证，仅保证不抛错）

## 3. Headless / SSH 守卫

- [x] 3.1 在 `src/notifications/guard.ts` 实现 `shouldAttemptOsChannel(): boolean`：检查 `SSH_CONNECTION`/`SSH_TTY`、Linux `DISPLAY`/`WAYLAND_DISPLAY`、`/run/user/${uid}/bus` socket、`Bun.which("notify-send")`；macOS 非总返回 `true`
- [x] 3.2 实现 `isSshSession(): boolean` 单独导出（OSC 通道在 SSH 下仍尝试，OS 通道 no-op，二者守卫逻辑分离）

## 4. NotificationRouter 编排

- [x] 4.1 在 `src/notifications/notifier.ts` 实现 `NotificationRouter` 类：构造接收 `NotificationsConfig`、`renderer?`（可选，TUI 模式注入）、`onToast?` 回调（可选，TUI 模式注入）；维护 `bashStartTimes: Map<toolCallId, number>`
- [x] 4.2 实现 `notify(payload: NotificationPayload): Promise<void>`：按 D1 三层级联（OSC → OS → no-op），TUI Toast 走 `onToast` 回调独立触发；每层失败降级，全程不抛错
- [x] 4.3 实现 `handleEvent(event: AgentSessionEvent): Promise<void>`：把 `AgentSessionEvent` 翻译成 `NotificationPayload` 或跳过（含 bash 阈值判断、`isError` 判断、`events.*` 配置过滤、`channels.*` 配置过滤）
- [x] 4.4 实现 `updateConfig(config: NotificationsConfig): void`，供 `Setting.apply` 调用即时切换运行时配置；实现 `setRenderer(renderer)` / `setToastHandler(fn)` 供 TUI 模式注入

## 5. 事件接入

- [x] 5.1 在 `src/server/index.ts` 的 `AgentServer` 构造函数（或 `ensureSubscribed()` 附近）创建 `NotificationRouter` 单例，并作为额外 `EventHandler` 注册到 `session.subscribe` 的 fan-out；构造时传入 `convertConfigToNotifications(session.settingsManager)` 或等价读取路径
- [x] 5.2 在 `src/tools/question.ts:58`（Promise await 处）调用 `router.notify({ event: "needsInput", ... })` 触发「需要输入」通知；通过模块级单例或参数注入获取 router
- [x] 5.3 验证 headless 模式（`src/headless/runner.ts`）经 server 订阅自动收到通知，无需额外改动；如 runner 不经过 server，补一行 router 注入

## 6. TUI Toast 组件

- [x] 6.1 在 `src/tui/hooks/useToasts.ts` 实现 `useToasts()` hook：维护 `toasts: ToastItem[]` 状态、`pushToast(payload)` 入栈、每条 4000ms 后自动 `setTimeout` 出栈
- [x] 6.2 在 `src/tui/components/Toast.tsx` 实现 `<Toast>` overlay 组件：渲染在 StatusBar 上方，按 `colors` 主题配色，参考 `StatusBar.tsx:32-38` 的 `copyFeedback` 模式；多 Toast 堆叠时仅显示最新一条
- [x] 6.3 在 `src/tui/App.tsx` 挂载 `<Toast>` overlay，调用 `useToasts()`，将 `pushToast` 作为 `onToast` 回调注入 `NotificationRouter`（通过 server 或 client 暴露的 setter）

## 7. 设置项注册

- [x] 7.1 在 `src/settings/notifications-enabled.ts` 实现 `notificationsEnabledSetting: Setting<boolean>`：`key: "notifications.enabled"`、`label: "通知"`、`defaultValue: true`、`read`/`edit`/`apply`（调用 router.updateConfig）/`persist`
- [x] 7.2 在 `src/settings/notifications-sound.ts` 实现 `notificationsSoundSetting: Setting<boolean>`：`key: "notifications.sound"`、`defaultValue: true`，`apply` 即时切换 router 配置
- [x] 7.3 在 `src/settings/notifications-bash-threshold.ts` 实现 `notificationsBashThresholdSetting: Setting<number>`：`key: "notifications.bashThresholdSeconds"`、`defaultValue: 10`、`edit` 接受数字输入（秒），`persist` 时换算为毫秒写入 `bashThresholdMs`
- [x] 7.4 在 `src/settings/registry.ts` 的 `settings` 数组追加上述三个 Setting，归入合适 `category` 分组（如「通知」新分组或现有「显示」分组）

> 注：实施时遵循项目现有风格，三个 setting 集中在 `src/settings/definitions.ts` 而非独立文件；bash 阈值用 `Setting<string>` 适配 input editor。

## 8. 测试

- [x] 8.1 在 `tests/notifications.test.ts` 测试 `resolveNotificationsConfig`：全缺失走默认、`enabled:false` 短路、单事件/单通道关闭互不影响、嵌套合并
- [x] 8.2 测试 `shouldAttemptOsChannel` / `isSshSession`：mock `process.env` 与 `Bun.which`，覆盖 macOS / Linux 有 GUI / Linux 无 GUI / SSH 四种场景
- [x] 8.3 测试 `NotificationRouter.handleEvent`：mock 通道，验证 `agent_end` 触发、`isError` 触发、bash 短时不触发 / 长时触发、`events.*` 关闭跳过、`channels.*` 关闭跳过
- [x] 8.4 运行 `bun run check` 确认 typecheck + lint + test 全绿

## 9. 文档与收尾

- [x] 9.1 在 `README.md` 或 `AGENTS.md` 通知配置段（如无则新增）说明：默认开启、`/setting` 可关、config.json 细粒度配置示例、tmux `allow-passthrough` 提示、macOS 通知权限授权步骤
- [x] 9.2 手动验收：TUI 模式触发 `agent_end`（应同时显示 Toast + OS 通知）、headless 模式触发 `agent_end`（仅 OS 通知）、SSH 下触发（OSC 尝试、OS no-op）、`/setting` 关闭总开关后无任何通知

> 注：9.2 完整端到端验收（真实 LLM + 真实终端触发通知）留待步骤 6 用户验收；实施期已完成运行时冒烟（模块加载 + router 实例化 + handleEvent + notifyNeedsInput 全部通过）+ 21 项单元测试覆盖事件翻译/通道选择/配置过滤逻辑。
