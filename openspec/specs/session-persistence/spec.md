# session-persistence Specification

## Purpose
定义 openagent 会话的磁盘持久化、进程重启后的历史上下文恢复，以及多会话的列表 / 打开 / 命名管理。基于 Pi SDK 的 `SessionManager`（append-only JSONL）实现，openagent 仅提供目录策略与恢复入口薄层，不自建存储或重放。
## Requirements
### Requirement: 会话磁盘持久化

系统 SHALL 使用 Pi SDK 的磁盘 `SessionManager` 把会话持久化到 openagent 数据目录，采用 SDK 的 append-only JSONL 格式；SHALL NOT 写入 `~/.pi/` 目录。`AuthStorage` / `ModelRegistry` / `SettingsManager` 保持 `inMemory()`。此持久化 SHALL 同时覆盖 leader session 和 team 成员 session——两者使用相同的 `SessionManager` API，成员 session 文件存放在标准 sessions 目录（`~/.config/openagent/sessions/`）下，与 leader session 并列。TEAM.md 只持有成员的 sessionFile 引用。

#### Scenario: 新建持久化会话
- **WHEN** 用户无恢复参数启动（`openagent`）
- **THEN** 系统 SHALL 调用 `SessionManager.create(cwd, sessionDir)` 创建磁盘会话
- **AND** 后续对话通过 SDK 自动 append-only 写入 JSONL 文件

#### Scenario: 成员会话持久化（与 leader 同构）
- **WHEN** `TeamManager.createMember` 创建新成员
- **THEN** SHALL 使用 `SessionManager.create(cwd, sessionDir)` 创建持久化成员会话
- **AND** sessionDir SHALL 为标准 `resolveSessionDir()`（与 leader 相同）
- **AND** 成员对话消息 SHALL 通过 SDK 自动写入 JSONL 文件
- **AND** `MemberState.sessionFile` SHALL 记录成员的 session 文件路径
- **AND** TEAM.md members 表 SHALL 通过 Session 列记录该路径

#### Scenario: 运行时追加写盘
- **WHEN** 用户或成员发送消息触发 Agent 循环
- **THEN** SDK SHALL 通过 `SessionManager.appendMessage` 把每条消息追加到当前会话的 JSONL 文件

#### Scenario: 会话恢复对称性
- **WHEN** 系统恢复已有会话
- **THEN** leader SHALL 使用 `SessionManager.open/continueRecent` 恢复
- **AND** 成员 SHALL 使用 `SessionManager.open(sessionFile, sessionDir)` 恢复（与 leader 的恢复路径完全对称）
- **AND** 两者的恢复方式 SHALL 遵循相同的 SDK API

#### Scenario: 不污染 pi 目录
- **WHEN** 系统创建或写入会话
- **THEN** SHALL NOT 在 `~/.pi/` 下创建任何文件或目录

### Requirement: 进程重启后恢复会话
系统 SHALL 在启动时根据恢复意图（continue / resume / session / new）构造对应的 `SessionManager`，由 `createAgentSession` 内建逻辑自动检测并恢复历史 messages / model / thinkingLevel。

#### Scenario: 恢复最近会话
- **WHEN** 用户运行 `openagent --continue`
- **THEN** 系统 SHALL 调用 `SessionManager.continueRecent(cwd, sessionDir)`
- **AND** `createAgentSession` SHALL 自动加载该 cwd 最近会话的历史 messages 注入 Agent，并恢复 model / thinkingLevel

#### Scenario: 按会话 id 恢复
- **WHEN** 用户运行 `openagent --session <id>` 或 TUI 内执行 `/resume <id>`
- **THEN** 系统 SHALL 调用 `SessionManager.list(cwd, sessionDir)` 找到 id 匹配的会话文件 path
- **AND** 调用 `SessionManager.open(path, sessionDir)` 加载，由 SDK 恢复历史上下文
- **AND** TUI 内触发时（`/resume`）走运行时热切换（`runtime.switchSession`，不重启进程，详见 agent-session 规格）

#### Scenario: 按文件路径恢复
- **WHEN** 用户运行 `openagent --session <path>`（path 为现有文件路径）
- **THEN** 系统 SHALL 调用 `SessionManager.open(<path>, sessionDir)` 加载指定会话文件

#### Scenario: 无可恢复会话时降级为新建
- **WHEN** 用户运行 `openagent --continue` 但当前 cwd 无任何历史会话
- **THEN** 系统 SHALL 退化为新建持久化会话（等价于 `SessionManager.create`），不报错

#### Scenario: 恢复时模型不可用降级
- **WHEN** 恢复的会话原 model 在当前环境不可用
- **THEN** SDK SHALL 返回 `modelFallbackMessage`，系统 SHALL 在 TUI 显示该降级提示并回退到可用模型

### Requirement: 多会话列表
系统 SHALL 能列出当前 cwd 的所有持久化会话，展示序号、相对时间、首条消息预览与消息数，供用户选择恢复。

#### Scenario: 列出当前 cwd 会话
- **WHEN** 用户执行 `/sessions`
- **THEN** 系统 SHALL 调用 `SessionManager.list(cwd, sessionDir)` 获取 `SessionInfo[]`
- **AND** 渲染列表，每项含：序号、相对时间（`SessionInfo.modified`）、首条消息预览（`SessionInfo.firstMessage`）、消息数（`SessionInfo.messageCount`）、会话名（若有）

#### Scenario: 空列表提示
- **WHEN** 用户执行 `/sessions` 但当前 cwd 无任何会话
- **THEN** 系统 SHALL 显示「当前目录暂无会话」提示

#### Scenario: 列表数据支持热切换
- **WHEN** 用户在 `/sessions` 列表选择某项（或执行 `/resume <序号|id>`）
- **THEN** 系统 SHALL 用该项的 `path` 调用 `runtime.switchSession(path)` 运行时热切换（不重启进程，详见 agent-session 规格）

### Requirement: 会话命名
系统 SHALL 支持给会话命名，名称通过 SDK `setSessionName`（底层 `appendSessionInfo`）持久化，并在 `/sessions` 列表中优先显示。

#### Scenario: 命名当前会话
- **WHEN** 用户执行 `/name <text>`
- **THEN** 系统 SHALL 调用 `session.setSessionName(<text>)`，SDK 自动把名称持久化到当前会话 JSONL

#### Scenario: 列表优先显示名称
- **WHEN** 渲染 `/sessions` 列表且某会话已命名
- **THEN** 该项 SHALL 优先显示会话名称，未命名的会话显示首条消息预览

