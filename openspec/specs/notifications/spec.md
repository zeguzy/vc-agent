# notifications Specification

## Purpose
端到端原生通知能力：将 Pi SDK 事件（agent 完成、工具失败、需要输入等）转换为用户可感知的通知，通过三层级联通道（OSC → 平台二进制 → no-op）投递，覆盖 TUI / headless run / serve+attach 全部运行模式。默认开启，可配置。

## Requirements

### Requirement: 三层级联通知通道
系统 SHALL 按固定优先级尝试投递通知：① OpenTUI `renderer.triggerNotification()`（OSC 99/9 终端协议）→ ② 平台原生二进制（macOS `terminal-notifier` 优先、`osascript` 兜底；Linux `notify-send`；Windows `SnoreToast`）→ ③ 全部失败时静默 no-op。每一层失败 SHALL 自动降级到下一层，绝不抛错中断主流程。

#### Scenario: OSC 通道优先且成功
- **WHEN** 触发通知且 `channels.osc !== false` 且 OpenTUI renderer 存在且 `triggerNotification()` 返回 `true`
- **THEN** 系统 SHALL 通过 OSC 通道投递通知，且 SHALL NOT 调用平台二进制

#### Scenario: OSC 失败降级到平台二进制
- **WHEN** OSC 通道被配置关闭，或 renderer 不可用，或 `triggerNotification()` 返回 `false`
- **THEN** 系统 SHALL 降级到平台原生二进制通道（macOS `terminal-notifier` → `osascript`；Linux `notify-send`；Windows `SnoreToast`）

#### Scenario: 平台二进制不可用降级到 osascript
- **WHEN** 平台为 macOS 且 `terminal-notifier` 不在 `$PATH`
- **THEN** 系统 SHALL 降级到 `osascript -e 'display notification'` 兜底

#### Scenario: 全部通道失败静默 no-op
- **WHEN** 所有通道均不可用或全部抛错
- **THEN** 系统 SHALL 静默忽略该通知，SHALL NOT 抛出异常或写入 stderr 影响主流程

### Requirement: Headless / SSH 环境守卫
系统 SHALL 在调用平台原生二进制前检测运行环境，无 GUI 时静默 no-op。

#### Scenario: SSH 远程会话
- **WHEN** `process.env.SSH_CONNECTION` 或 `process.env.SSH_TTY` 存在
- **THEN** 平台原生二进制通道 SHALL no-op；OSC 通道 SHALL 仍尝试（序列可经 SSH 流透传到本地终端）

#### Scenario: Linux 无图形会话
- **WHEN** 平台为 Linux 且 `process.env.DISPLAY` 与 `process.env.WAYLAND_DISPLAY` 均为空
- **THEN** 平台原生二进制通道 SHALL no-op

#### Scenario: Linux 无 D-Bus 用户总线
- **WHEN** 平台为 Linux 且 `/run/user/${uid}/bus` socket 不存在
- **THEN** `notify-send` 通道 SHALL no-op

#### Scenario: notify-send 未安装
- **WHEN** 平台为 Linux 且 `Bun.which("notify-send")` 返回 null
- **THEN** 系统 SHALL no-op，不抛错

#### Scenario: macOS 总视为有 GUI
- **WHEN** 平台为 macOS 且非 SSH 会话
- **THEN** 系统 SHALL 始终尝试平台二进制通道（macOS 总有 Aqua session）

### Requirement: 事件触发映射
系统 SHALL 在 `AgentServer.ensureSubscribed()`（`src/server/index.ts`）注册独立的事件订阅者，覆盖 TUI / headless run / serve+attach 全部运行模式，并按以下规则触发通知：

#### Scenario: Agent 一轮完成
- **WHEN** 收到 `agent_end` 事件且 `events.agentEnd !== false`
- **THEN** 系统 SHALL 触发标题为「openagent」、内容为「Agent 已完成本轮响应」的通知

#### Scenario: 工具执行失败
- **WHEN** 收到 `tool_execution_end` 事件且 `event.isError === true` 且 `events.toolError !== false`
- **THEN** 系统 SHALL 触发内容包含工具名与错误摘要的通知

#### Scenario: 长时 bash 完成
- **WHEN** 收到 `tool_execution_end` 事件、`event.toolName === "bash"`、且自对应 `tool_execution_start` 起的耗时 ≥ `bashThresholdMs`（默认 10000）、且 `events.longBash !== false`
- **THEN** 系统 SHALL 触发内容包含耗时与命令摘要的通知

#### Scenario: 短时 bash 不通知
- **WHEN** 收到 `tool_execution_end` 事件、`event.toolName === "bash"`、且耗时 < `bashThresholdMs`
- **THEN** 系统 SHALL NOT 触发通知

#### Scenario: 需要用户输入
- **WHEN** `question` 工具（`src/tools/question.ts`）的 Promise 进入 await 状态且 `events.needsInput !== false`
- **THEN** 系统 SHALL 触发高优先级通知，内容表明「Agent 正在等待你的回答」

#### Scenario: 上下文压缩完成
- **WHEN** 收到 `compaction_end` 事件且 `event.aborted !== true` 且 `event.errorMessage` 为空且 `events.compactionEnd !== false`
- **THEN** 系统 SHALL 触发轻量通知（仅 TUI Toast，不发 OS 原生通知）

### Requirement: 配置生效与默认值
系统 SHALL 读取 `Config.notifications` 配置块，缺失任何字段时走默认值（总开关 `enabled` 默认 `true`，所有事件默认开，所有通道默认开，`bashThresholdMs` 默认 `10000`，`sound` 默认 `true`）。

#### Scenario: 配置完全缺失走默认全开
- **WHEN** `Config.notifications` 为 `undefined`
- **THEN** 系统 SHALL 视为 `enabled: true`、所有事件开、所有通道开、`bashThresholdMs: 10000`

#### Scenario: 全局总开关关闭
- **WHEN** `notifications.enabled === false`
- **THEN** 系统 SHALL NOT 触发任何通道的任何通知，无论事件/通道子项如何配置

#### Scenario: 单通道关闭
- **WHEN** `channels.os === false`（其他通道开）
- **THEN** 系统 SHALL 跳过平台原生二进制通道，OSC 与 Toast 通道行为不受影响

#### Scenario: 单事件关闭
- **WHEN** `events.agentEnd === false`（其他事件开）
- **THEN** 系统 SHALL 在收到 `agent_end` 事件时不触发通知，其他事件行为不受影响

#### Scenario: 项目级覆盖全局级
- **WHEN** 全局 config 设 `notifications.enabled: true` 且项目 config 设 `notifications.enabled: false`
- **THEN** 项目级 SHALL 覆盖全局级（沿用现有 `deepMerge` 语义）

### Requirement: TUI Toast 组件
系统 SHALL 提供 TUI 内 Toast 组件，在 TUI 运行模式下作为在场反馈通道，与 OS/OSC 通道并存。

#### Scenario: TUI 模式下 Toast 显示
- **WHEN** TUI 运行且 `channels.toast !== false` 且触发通知
- **THEN** 系统 SHALL 在 TUI 顶部（StatusBar 上方）渲染 Toast，包含标题与内容

#### Scenario: Toast 自动消失
- **WHEN** Toast 显示后经过超时时长（默认 4000ms）
- **THEN** Toast SHALL 自动从屏幕移除

#### Scenario: Toast 不阻塞输入
- **WHEN** Toast 显示中
- **THEN** 用户输入框 SHALL 保持可交互，Toast 不拦截键盘事件

#### Scenario: headless 模式无 Toast
- **WHEN** 运行模式为 `openagent run`（headless）
- **THEN** 系统 SHALL NOT 尝试渲染 Toast

### Requirement: 不引入 node-notifier 依赖
系统 SHALL NOT 在 `package.json` 中新增 `node-notifier` 或任何 vendor 通知二进制的 npm 依赖；所有平台二进制 SHALL 通过 `Bun.spawn` 调用 `$PATH` 中的系统/Brew 安装。

#### Scenario: package.json 无新增通知依赖
- **WHEN** 实施完成
- **THEN** `package.json` 的 `dependencies` 与 `devDependencies` SHALL NOT 包含 `node-notifier`、`terminal-notifier` 或任何通知库
