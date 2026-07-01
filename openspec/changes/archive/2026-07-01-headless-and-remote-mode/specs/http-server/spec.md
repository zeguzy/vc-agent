## ADDED Requirements

### Requirement: HTTP server via `openagent serve`

系统 SHALL 支持 `openagent serve` 命令，启动 HTTP server 暴露 REST API + SSE 事件流。

#### Scenario: Start server

- **WHEN** 用户执行 `openagent serve`
- **THEN** 系统创建 AgentServer，启动 Bun.serve 监听端口（默认 4096），打印 server URL

#### Scenario: Custom port

- **WHEN** 用户执行 `openagent serve --port 8080`
- **THEN** server 监听 8080 端口

### Requirement: REST API endpoints

HTTP server SHALL 暴露以下端点，每个端点对应 AgentServer 的 handler 方法：
- `POST /prompt` — 发送消息
- `POST /follow-up` — 发送后续消息
- `POST /abort` — 中止执行
- `POST /compact` — 压缩上下文
- `POST /session/new` — 新建会话
- `POST /session/switch` — 切换会话
- `GET /session/id` — 获取会话 ID
- `GET /session/name` — 获取会话名称
- `POST /session/name` — 设置会话名称
- `GET /model` — 获取当前模型
- `GET /context` — 获取上下文用量
- `GET /messages` — 获取消息列表
- `POST /mode` — 设置 agent 模式
- `GET /sessions` — 列出会话

#### Scenario: Send prompt via HTTP

- **WHEN** 客户端发送 `POST /prompt {"text":"hello"}`
- **THEN** server 调用 `server.handlePrompt("hello")`，返回 `{"ok":true}`

#### Scenario: Get context usage

- **WHEN** 客户端发送 `GET /context`
- **THEN** server 返回 `{"tokens":1234,"contextWindow":200000,"percent":0.6}`

### Requirement: SSE event stream

HTTP server SHALL 提供 `GET /events` 端点，返回 `text/event-stream`，实时推送 agent 事件。

#### Scenario: Stream events

- **WHEN** agent 产生事件（如 message_update）
- **THEN** server 通过 SSE 推送 `data: {"type":"message_update","message":{...}}\n\n`

#### Scenario: Multiple event subscribers

- **WHEN** 多个客户端连接到 `/events`
- **THEN** 所有客户端都收到相同的事件流
