# question-tool Specification

## Purpose
TBD - created by archiving change add-question-tool. Update Purpose after archive.
## Requirements
### Requirement: question 工具定义
系统 SHALL 提供一个名为 `question` 的 Agent 工具，允许 Agent 向用户展示结构化问题并等待用户交互式回答。工具参数 SHALL 使用 TypeBox schema 定义，包含 `questions` 数组，每个问题包含 `question`（完整描述）、`header`（≤30 字符短标签）、`options`（选项数组，每项含 `label` 和 `description`）、可选 `multiple`（布尔值，是否允许多选）。

#### Scenario: 工具参数 schema
- **WHEN** 定义 question 工具的 parameters
- **THEN** schema SHALL 为 `Type.Object({ questions: Type.Array(Type.Object({ question: Type.String(), header: Type.String({ maxLength: 30 }), options: Type.Array(Type.Object({ label: Type.String(), description: Type.String() })), multiple: Type.Optional(Type.Boolean()) })) })`

#### Scenario: 单问题调用
- **WHEN** Agent 调用 question 工具，questions 数组包含 1 个问题
- **THEN** 工具 SHALL 通过 QuestionBridge 将问题数据传递给 TUI 层，并等待用户回答后返回结果

#### Scenario: 多问题调用
- **WHEN** Agent 调用 question 工具，questions 数组包含多个问题
- **THEN** 工具 SHALL 将所有问题传递给 TUI 层，等待用户逐一回答后返回全部结果

#### Scenario: 工具返回值格式
- **WHEN** 用户完成所有问题的回答
- **THEN** 工具 SHALL 返回 `AgentToolResult`，其中 content 为包含回答摘要的文本，details 包含 `answers: string[][]`（每个问题的选中 label 数组）

#### Scenario: 工具 prompt 描述
- **WHEN** Agent 读取 question 工具的 description
- **THEN** description SHALL 指导 Agent 在需要澄清意图、确认方案或获取决策时使用此工具，并说明每个字段（question、header、options、multiple）的用途

