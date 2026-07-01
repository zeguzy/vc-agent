## ADDED Requirements

### Requirement: Headless execution via `openagent run`

系统 SHALL 支持 `openagent run "<prompt>"` 命令，在非交互模式下执行单次 agent prompt 并将结果输出到 stdout。

#### Scenario: Single prompt execution

- **WHEN** 用户执行 `openagent run "explain this code"`
- **THEN** 系统创建 AgentServer + AgentClient（in-process），调用 `client.prompt(text)`，订阅事件流，将 assistant 消息增量输出到 stdout，agent_end 后进程退出

#### Scenario: Streaming output

- **WHEN** agent 产生 message_update 事件
- **THEN** 增量文本实时写入 stdout（不缓冲），用户看到流式输出

#### Scenario: Tool execution display

- **WHEN** agent 产生 tool_execution_start/end 事件
- **THEN** stdout 显示工具名和简要参数（如 `[tool: read src/index.ts]`），工具结果可折叠或省略

#### Scenario: Exit code

- **WHEN** agent_end 事件触发
- **THEN** 进程以 exit code 0 退出（成功）或非零退出（如果有 error 事件）

### Requirement: Continue session in headless mode

系统 SHALL 支持 `openagent run --continue "<prompt>"` 和 `openagent run --session <id> "<prompt>"` 选项，复用已有会话。

#### Scenario: Continue most recent session

- **WHEN** 用户执行 `openagent run -c "next step"`
- **THEN** 系统恢复当前目录最近的会话，在已有上下文中发送 prompt
