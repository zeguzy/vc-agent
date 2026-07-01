## ADDED Requirements

### Requirement: question 工具注册
系统 SHALL 在创建 Agent 会话时，将 `createQuestionTool(bridge)` 注册到 `customTools` 数组中，与 LSP 工具和 todo 工具并列。bridge 对象 SHALL 通过 `createRuntime` 的参数传入，传递到 runtime factory 内部。

#### Scenario: createRuntime 接收 bridge
- **WHEN** 调用 `createRuntime({cwd, model, config, mode, agentMode, sessionRef, name, bridge})`
- **THEN** runtime factory SHALL 调用 `createQuestionTool(bridge)` 并将返回的 ToolDefinition 加入 `customTools` 数组

#### Scenario: createSession（legacy）接收 bridge
- **WHEN** 调用 `createSession({...bridge})`（in-memory 模式）
- **THEN** SHALL 同样注册 `createQuestionTool(bridge)` 到 customTools

#### Scenario: bridge 未传入时降级
- **WHEN** bridge 参数为 undefined（如 headless/HTTP 模式）
- **THEN** `createQuestionTool(undefined)` SHALL 返回一个工具定义，其 execute() 检测到 bridge 不可用时立即返回错误结果，不阻塞
