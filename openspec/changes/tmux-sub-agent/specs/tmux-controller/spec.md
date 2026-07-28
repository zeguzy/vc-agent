## ADDED Requirements

### Requirement: TmuxController 环境检测与版本探测

系统 SHALL 提供 `src/tmux/controller.ts` 模块，导出 `TmuxController` 类，封装 tmux 二进制调用。`TmuxController` SHALL 通过 `node:child_process.execSync` 调用 tmux 命令（不使用 `Bun.spawn`，项目 tsconfig 不含 Bun 全局）。系统 SHALL 提供静态方法 `isInTmux()` 检测 `process.env.TMUX` 是否非空，返回布尔值。`TmuxController` 构造时 SHALL 执行 `tmux -V` 探测版本，失败时标记 `available = false`，后续所有方法降级为 no-op 并记录警告日志。

#### Scenario: 在 tmux 内运行
- **WHEN** `process.env.TMUX` 非空
- **THEN** `TmuxController.isInTmux()` SHALL 返回 `true`
- **AND** `TmuxController` 实例的 `available` SHALL 为 `true`（前提是 tmux 二进制存在）

#### Scenario: 不在 tmux 内
- **WHEN** `process.env.TMUX` 为空或 undefined
- **THEN** `TmuxController.isInTmux()` SHALL 返回 `false`

#### Scenario: tmux 未安装
- **WHEN** 系统执行 `tmux -V` 失败（命令未找到）
- **THEN** `TmuxController.available` SHALL 为 `false`
- **AND** 所有后续方法调用（splitWindow/sendKeys/capturePane/listPanes/killPane）SHALL 是 no-op 并返回 `null` 或空数组
- **AND** SHALL 在 stderr 输出一次性警告

### Requirement: tmux 分屏操作

系统 SHALL 提供 `splitWindow(opts)` 方法创建新的 tmux pane。`opts` 包含可选的 `command`（pane 内启动命令）、`cwd`（工作目录）、`name`（pane 标题）、`vertical`（布尔，默认 false，水平分屏）。方法 SHALL 执行 `tmux split-window [-v] [-c <cwd>] [-P -F '#{pane_id}'] [<command>]`，返回新 pane 的 ID（格式 `%N`）。

#### Scenario: 水平分屏
- **WHEN** 调用 `splitWindow({ vertical: false })`
- **THEN** SHALL 执行 `tmux split-window -P -F '#{pane_id}'`
- **AND** 返回形如 `%5` 的 pane ID 字符串

#### Scenario: 指定工作目录和命令
- **WHEN** 调用 `splitWindow({ cwd: "/tmp", command: "opencode serve" })`
- **THEN** SHALL 执行 `tmux split-window -c /tmp -P -F '#{pane_id}' opencode serve`
- **AND** 返回新 pane ID

### Requirement: tmux 按键发送（两次调用模式）

系统 SHALL 提供 `sendKeys(paneId, text, opts?)` 方法向指定 pane 发送文本。当 `opts.enter` 为 `true`（默认）时，方法 SHALL 执行两次 tmux 调用：先 `tmux send-keys -t <paneId> -l "<text>"`（literal 模式，避免按键名解释），再 `tmux send-keys -t <paneId> Enter`。当 `opts.enter` 为 `false` 时只执行第一次调用。

#### Scenario: 发送文本并回车
- **WHEN** 调用 `sendKeys("%5", "hello", { enter: true })`
- **THEN** SHALL 执行 `tmux send-keys -t %5 -l hello`
- **AND** SHALL 执行 `tmux send-keys -t %5 Enter`

#### Scenario: 发送文本不回车
- **WHEN** 调用 `sendKeys("%5", "hello", { enter: false })`
- **THEN** SHALL 只执行 `tmux send-keys -t %5 -l hello`

### Requirement: tmux 输出捕获

系统 SHALL 提供 `capturePane(paneId, opts?)` 方法捕获 pane 屏幕内容。方法 SHALL 执行 `tmux capture-pane -t <paneId> -p [-e] [-S <start>]`，返回字符串。`opts.lines` 控制捕获行数（传给 `-S` 参数，默认 `-` 表示全部 scrollback），`opts.escape` 为 `true` 时加 `-e` 保留 ANSI 转义。

#### Scenario: 捕获纯文本
- **WHEN** 调用 `capturePane("%5")`
- **THEN** SHALL 执行 `tmux capture-pane -t %5 -p -S -`
- **AND** 返回 pane 的纯文本内容（去除 ANSI 转义）

#### Scenario: 捕获带 ANSI 的文本
- **WHEN** 调用 `capturePane("%5", { escape: true })`
- **THEN** SHALL 执行 `tmux capture-pane -t %5 -p -e -S -`
- **AND** 返回保留 ANSI 转义序列的文本

### Requirement: tmux pane 列举与销毁

系统 SHALL 提供 `listPanes(sessionName?)` 方法列举当前 session 或指定 session 的所有 pane。方法 SHALL 执行 `tmux list-panes [-t <sessionName>] -F '#{pane_id}\t#{pane_title}\t#{pane_active}'`，返回 `PaneInfo[]` 数组。系统 SHALL 提供 `killPane(paneId)` 方法销毁指定 pane，执行 `tmux kill-pane -t <paneId>`。

#### Scenario: 列举当前 session 的 pane
- **WHEN** 调用 `listPanes()` 不传参
- **THEN** SHALL 执行 `tmux list-panes -F '#{pane_id}\t#{pane_title}\t#{pane_active}'`
- **AND** 返回 `PaneInfo[]`，每个元素含 `{ id, title, active }`

#### Scenario: 销毁 pane
- **WHEN** 调用 `killPane("%5")`
- **THEN** SHALL 执行 `tmux kill-pane -t %5`
