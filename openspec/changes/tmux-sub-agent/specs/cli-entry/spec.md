## ADDED Requirements

### Requirement: runTui tmux 自启检测

系统 SHALL 在 `src/index.tsx` 的 `runTui()` 函数入口处增加 tmux 自启检测逻辑。当 `config.tmux.autoStart` 为 `true` 且 `process.env.TMUX` 为空时，系统 SHALL 自动创建 tmux session 并在其中重新启动自身。自启逻辑 SHALL 通过 `node:child_process.execSync` 执行 `tmux new-session -d -s <sessionName> <self-restart-command>` 创建 detached session，再执行 `tmux attach-session -t <sessionName>` attach，最后 `process.exit(0)` 退出当前非 tmux 进程。`config.tmux.autoStart` 默认 SHALL 为 `false`。

#### Scenario: autoStart 关闭（默认）
- **WHEN** `config.tmux.autoStart` 为 `false` 或未配置
- **AND** `process.env.TMUX` 为空（不在 tmux 内）
- **THEN** SHALL 跳过自启逻辑，正常启动 TUI

#### Scenario: autoStart 开启且不在 tmux 内
- **WHEN** `config.tmux.autoStart` 为 `true`
- **AND** `process.env.TMUX` 为空
- **THEN** SHALL 执行 `tmux new-session -d -s vcagent bun run src/index.tsx [args...]`
- **AND** SHALL 执行 `tmux attach-session -t vcagent`
- **AND** SHALL 调用 `process.exit(0)` 退出当前进程

#### Scenario: autoStart 开启但已在 tmux 内
- **WHEN** `config.tmux.autoStart` 为 `true`
- **AND** `process.env.TMUX` 非空（已在 tmux 内）
- **THEN** SHALL 跳过自启逻辑，正常启动 TUI

#### Scenario: 自定义 session 名
- **WHEN** `config.tmux.sessionName` 配置为 `"my-agent"`
- **AND** 触发自启
- **THEN** 创建的 tmux session 名 SHALL 为 `"my-agent"`

#### Scenario: tmux 未安装
- **WHEN** `config.tmux.autoStart` 为 `true`
- **AND** `tmux` 命令不存在（execSync 抛错）
- **THEN** SHALL 捕获错误，在 stderr 输出警告，降级为非 tmux 模式启动 TUI
