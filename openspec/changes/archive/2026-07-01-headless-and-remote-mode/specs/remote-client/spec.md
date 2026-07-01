## ADDED Requirements

### Requirement: Remote attach via `openagent attach`

系统 SHALL 支持 `openagent attach <url>` 命令，连接到远程 HTTP server 并以 TUI 模式操作。

#### Scenario: Connect to remote server

- **WHEN** 用户执行 `openagent attach http://localhost:4096`
- **THEN** 系统创建 HttpClient（实现 AgentClient 接口），传给 `<App>`，TUI 通过 fetch+SSE 操作远程 server

#### Scenario: Event subscription via SSE

- **WHEN** TUI 调用 `client.subscribe(handler)`
- **THEN** HttpClient 建立 SSE 连接到 `/events`，解析事件并转发给 handler

### Requirement: HttpClient implements AgentClient

HttpClient SHALL 实现 AgentClient 接口的核心方法（prompt/followUp/abort/subscribe/compact/newSession/switchSession/getContextUsage/getModel/getMessages/listSessions/setAgentMode/executeCommand）。

#### Scenario: Prompt via HTTP

- **WHEN** TUI 调用 `httpClient.prompt("hello")`
- **THEN** HttpClient 发送 `POST /prompt {"text":"hello"}` 并等待响应

#### Scenario: @internal methods not supported

- **WHEN** 任何代码调用 httpClient.getSettingsManager() 或 httpClient.getSession()
- **THEN** HttpClient 抛出 NotSupportedError
