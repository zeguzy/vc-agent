## ADDED Requirements

### Requirement: 会话恢复启动参数
系统 SHALL 在 CLI 入口支持会话恢复相关的启动参数（命名对齐 pi/opencode 习惯），决定 `createRuntime` 的 SessionManager 模式；无恢复参数时启动新建持久化会话。

#### Scenario: 无参数启动新建持久化会话
- **WHEN** 用户运行 `openagent`（无恢复参数）
- **THEN** 系统 SHALL 以 new 模式启动，创建新的持久化会话（`SessionManager.create`），进入 TUI

#### Scenario: -c/--continue 恢复最近会话
- **WHEN** 用户运行 `openagent -c` 或 `openagent --continue`
- **THEN** 系统 SHALL 以 continue 模式启动，恢复当前 cwd 最近会话；无历史时退化为新建持久化会话

#### Scenario: -r/--resume 打开会话列表
- **WHEN** 用户运行 `openagent -r` 或 `openagent --resume`
- **THEN** 系统 SHALL 进入 TUI 后立即打开会话列表（`/sessions` 视图），供用户浏览选择；选中后运行时热切换到目标会话

#### Scenario: --session 按 path 或 id 恢复
- **WHEN** 用户运行 `openagent --session <path>` 或 `openagent --session <id>`
- **THEN** 系统 SHALL 以 session 模式启动：若参数是现有文件路径则直接 `SessionManager.open(path)`；若是 id 则在当前 cwd 会话列表中匹配后 `open`
- **AND** 若未匹配到文件或会话，SHALL 显示错误并退出

#### Scenario: -n/--name 启动时命名
- **WHEN** 用户运行 `openagent -n <name>` 或 `openagent --name <name>`（可与其他参数组合）
- **THEN** 系统 SHALL 在会话创建/恢复后调用 `runtime.session.setSessionName(<name>)` 命名当前会话

#### Scenario: 参数与 --model 组合
- **WHEN** 用户同时指定恢复参数与 `--model`
- **THEN** 系统 SHALL 先按恢复参数加载历史会话，再以 `--model` 覆盖会话原 model

#### Scenario: 帮助文本包含新参数
- **WHEN** 用户运行 `openagent --help`
- **THEN** 帮助输出 SHALL 列出 `-c/--continue`、`-r/--resume`、`--session <path|id>`、`-n/--name <name>` 四个参数及说明
