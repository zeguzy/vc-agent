## MODIFIED Requirements

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
