## ADDED Requirements

### Requirement: 会话管理命令
系统 SHALL 提供 `/sessions`、`/resume`、`/continue`、`/new`、`/name` 五个斜杠命令管理会话生命周期，复用现有 `CommandRegistry`；`/sessions`、`/resume`、`/new` 通过 `AgentSessionRuntime` 走运行时热切换（详见 agent-session 规格「TUI 内运行时会话热切换」）。

#### Scenario: /sessions 列出会话（opencode 式 UX）
- **WHEN** 用户执行 `/sessions`
- **THEN** 系统 SHALL 调用 `runtime.session.sessionManager` 的 `SessionManager.list(cwd, sessionDir)` 获取当前 cwd 会话列表
- **AND** 按时间分组渲染（Today / 日期分组头），每项显示：序号 · 相对时间 · 会话名称（若有，否则首条消息预览）· 消息数
- **AND** 当前会话 SHALL 高亮标记
- **AND** 提示用户用 `/resume <序号|id>` 切换

#### Scenario: /sessions 空列表提示
- **WHEN** 用户执行 `/sessions` 但当前 cwd 无任何会话
- **THEN** 系统 SHALL 显示「当前目录暂无会话」提示

#### Scenario: /resume 按序号或 id 热切换
- **WHEN** 用户执行 `/resume <序号>` 或 `/resume <id>`
- **THEN** 系统 SHALL 解析参数：纯数字视为最近一次 `/sessions` 列表的序号匹配 path，否则视为会话 id 匹配
- **AND** 调用 `runtime.switchSession(<对应 path>)` 运行时热切换（不重启进程）
- **AND** 切换成功后通过 rebind 钩子自动重绑事件订阅 + 重渲染历史消息

#### Scenario: /resume 无参数等同 /sessions
- **WHEN** 用户执行 `/resume`（无参数）
- **THEN** 系统 SHALL 等同 `/sessions`，列出会话供选择

#### Scenario: /resume 目标无效
- **WHEN** 用户执行 `/resume <序号|id>` 但未匹配到任何会话
- **THEN** 系统 SHALL 显示错误「未找到会话 <参数>」，并建议执行 `/sessions` 查看

#### Scenario: /continue 为 /resume 别名
- **WHEN** 用户执行 `/continue` 或 `/continue <序号|id>`
- **THEN** 系统 SHALL 等同 `/resume` 的对应行为

#### Scenario: /new 热切换到新会话
- **WHEN** 用户执行 `/new`
- **THEN** 系统 SHALL 调用 `runtime.newSession()` 创建新的持久化会话并运行时热切换
- **AND** 切换成功后 rebind 钩子重绑 + 重渲染（新会话历史为空，显示欢迎消息）

#### Scenario: /name 命名当前会话
- **WHEN** 用户执行 `/name <text>`
- **THEN** 系统 SHALL 调用 `runtime.session.setSessionName(<text>)`，SDK 自动持久化名称到当前会话 JSONL

#### Scenario: /name 无参数显示当前名称
- **WHEN** 用户执行 `/name`（无参数）
- **THEN** 系统 SHALL 显示当前会话名称（若有）或「未命名」，并提示用法 `/name <text>`
