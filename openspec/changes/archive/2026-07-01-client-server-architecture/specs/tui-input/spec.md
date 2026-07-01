## MODIFIED Requirements

### Requirement: Message submission

系统 SHALL 通过 `AgentClient` 接口提交用户消息。InputBox 的 `handlePrompt(text)` 函数 MUST 调用 `client.prompt(text)`（首次消息）或 `client.followUp(text)`（后续消息），不再直接调用 `session.prompt()` 或 `session.followUp()`。

#### Scenario: First message in new session

- **WHEN** 用户在 InputBox 输入文本并按 Enter，当前消息列表为空
- **THEN** 系统调用 `client.prompt(text)`，消息通过 AgentClient → AgentServer → Pi SDK 提交

#### Scenario: Follow-up message in active session

- **WHEN** 用户输入文本并按 Enter，当前已有消息
- **THEN** 系统调用 `client.followUp(text)`

### Requirement: Abort via client

用户按 Ctrl+C 中止 agent 执行时，系统 MUST 调用 `client.abort()`，不再直接调用 `session.abort()`。

#### Scenario: Abort during agent execution

- **WHEN** agent 正在执行且用户按 Ctrl+C
- **THEN** 系统调用 `client.abort()`，AgentServer 转发给 `session.abort()`

### Requirement: Slash command execution

Slash 命令 SHALL 通过 `client.executeCommand(name, args)` 执行。命令 handler 接收 `ServerCommandContext`（含 `client` 和 `cwd`），不再接收 UI 回调函数。

#### Scenario: Command triggers prompt

- **WHEN** 用户执行 `/compact` 命令
- **THEN** `client.executeCommand("compact", [])` 被调用，Server 端 handler 通过 `ServerCommandContext` 执行 compaction 逻辑，UI 通过事件流感知状态变化

#### Scenario: Session management commands

- **WHEN** 用户执行 `/new`、`/resume`、`/sessions`、`/name` 等会话管理命令
- **THEN** 这些操作通过 `client.newSession()`、`client.switchSession()`、`client.listSessions()`、`client.setSessionName()` 执行

### Requirement: Skill command execution

Skill 命令（`/skills`、`/load-skill`、`/unload-skill`）SHALL 通过 `client.executeCommand()` 执行，SkillManager 操作封装在 AgentServer 内部。

#### Scenario: Load skill

- **WHEN** 用户执行 `/load-skill diagnose`
- **THEN** `client.executeCommand("load-skill", ["diagnose"])` 被调用，Server 端 handler 通过 SkillManager 加载 skill 并注入 agent 上下文
