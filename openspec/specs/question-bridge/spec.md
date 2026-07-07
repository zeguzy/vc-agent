# question-bridge Specification

## Purpose
定义 `QuestionBridge` 可变单例作为 question 工具的 Agent 工具层与 React TUI 层之间的通信桥梁，涵盖创建与传递、pending/resolve/reject 协议、中断清理、session 热切换清理和非交互模式降级。
## Requirements
### Requirement: QuestionBridge 桥接机制
系统 SHALL 提供 `QuestionBridge` 类型的可变对象，作为 Agent 工具层与 React TUI 层之间的通信桥梁。Bridge SHALL 在 `index.tsx` 中创建（进程级单例），并传递给 `createRuntime`（→ 工具工厂）和 `<App>`（→ QuestionBox 组件）。

#### Scenario: Bridge 创建与传递
- **WHEN** 应用启动（runTui）
- **THEN** `createQuestionBridge()` SHALL 返回一个包含 `pending`、`resolve`、`reject` 字段的可变对象
- **AND** 该对象 SHALL 传递给 `createRuntime({..., bridge})` 和 `<App bridge={bridge} />`

#### Scenario: 工具设置 pending question
- **WHEN** question 工具的 execute() 被调用
- **THEN** 工具 SHALL 将问题数据写入 `bridge.pending`
- **AND** SHALL 创建一个 Promise，将其 resolve/reject 回调存入 `bridge.resolve` / `bridge.reject`
- **AND** SHALL 返回该 Promise（阻塞 execute 直到用户回答）

#### Scenario: TUI 触发 resolve
- **WHEN** 用户在 QuestionBox 中完成所有问题的回答并提交
- **THEN** QuestionBox SHALL 调用 `bridge.resolve(answers)` 传入 `string[][]` 格式的答案
- **AND** 工具的 Promise SHALL resolve，execute 返回结果

#### Scenario: 中断时 reject
- **WHEN** Agent 被用户中断（Ctrl+C → AbortSignal）且 bridge.pending 存在
- **THEN** 工具 SHALL 监听 AbortSignal，调用 `bridge.reject(new AbortError())`
- **AND** SHALL 清空 bridge.pending

#### Scenario: session 热切换时清理
- **WHEN** runtime 触发 rebind 回调（session 切换）
- **THEN** App SHALL 清空 bridge.pending 并 reject 未完成的 Promise（如果有）

#### Scenario: 非交互模式降级
- **WHEN** question 工具在 headless（run）或 HTTP（serve）模式下被调用
- **THEN** 工具 SHALL 检测 bridge.resolve 是否可用（非 null）
- **AND** 若不可用，SHALL 立即返回错误结果（"question 工具在非交互模式下不可用"），不阻塞执行

