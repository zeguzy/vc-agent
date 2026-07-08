# subagent-model-config Specification

## Purpose
TBD - created by archiving change subagent-model-tier-config. Update Purpose after archive.
## Requirements
### Requirement: Subagent 模型 tier 映射系统

系统 SHALL 提供 config 层面的 subagent 模型配置，允许用户按 tier（fast/standard/powerful）为不同强度的 agent 配置不同模型，并提供链式回退确保模型解析失败时绝不静默路由到错误 provider。

Config 的 `subagents` 块 SHALL 支持三个可选字段：
- `modelTiers?: Partial<Record<"fast" | "standard" | "powerful", string>>` — 各档位对应的模型 id
- `models?: Record<string, string>` — 按 agent 名精确覆盖（最高优先级，绕过 tier）
- `fallback?: string` — 所有解析都失败时的兜底模型

#### Scenario: 配置三档模型

- **WHEN** 用户在 config.json 中配置 `subagents.modelTiers: { fast: "Astron:mini", standard: "Astron:latest", powerful: "Astron:max" }`
- **THEN** 系统 SHALL 在生成 subagent 时，根据 agent 的 `tier` 字段查找对应档位的模型 id
- **AND** 查找到的模型 id SHALL 经 `resolveModel(modelRegistry, modelId)` 解析为 ResolvedModel

#### Scenario: 按 agent 名精确覆盖

- **WHEN** 用户配置 `subagents.models: { nucleus: "Astron:astron-code-max" }` 且 agent `nucleus` 的 `tier` 为 `powerful`
- **THEN** 系统 SHALL 优先使用 `models.nucleus` 的值而非 `modelTiers.powerful` 的值
- **AND** 精确覆盖 SHALL 绕过 tier 系统，即使 agent 没有声明 tier 也生效

#### Scenario: 配置兜底模型

- **WHEN** 用户配置 `subagents.fallback: "Astron:astron-code-latest"`
- **THEN** 当 agent 的 tier 模型、agent.model、parentModel 均解析失败或不存在时
- **THEN** 系统 SHALL 使用 fallback 模型 id 经 `resolveModel` 解析

#### Scenario: subagents 块全部可选

- **WHEN** 用户未在 config.json 中配置 `subagents` 块
- **THEN** 系统 SHALL 不报错，解析链跳过 tier 和精确覆盖步骤，等价于 bug 修复后的行为（parentModel 优先于 agent.model）

### Requirement: Subagent 模型链式回退解析

系统 SHALL 在 `src/agents/model-resolver.ts` 提供统一函数 `resolveSubagentModel(opts)`，按以下优先级链式回退解析模型，任一环节命中即停止：

1. `config.subagents.models[agent.name]` — 精确覆盖
2. `config.subagents.modelTiers[agent.tier]` — tier 映射（仅当 agent.tier 存在）
3. `parentModel` — 父会话已解析的 ResolvedModel（直接使用，不经 resolveModel）
4. `agent.model` — agent frontmatter 声明的 model（经 resolveModel，有误匹配风险，仅 parentModel 不存在时尝试）
5. `extraFallback`（如 worker 路径的 `defaultWorkerModel`）— 调用方传入的额外兜底（经 resolveModel）
6. `config.subagents.fallback` — 显式兜底（经 resolveModel）
7. `config.model` — 全局默认模型（经 resolveModel）
8. 全部失败 → 返回 `undefined`，调用方 SHALL throw

步骤 1-2 和 4-7 的候选值 SHALL 经 `resolveModel(modelRegistry, candidate)` 解析；步骤 3 的 parentModel 已是 ResolvedModel，直接使用。parentModel（③）优先于 agent.model（④）是因为 `resolveModel` 对无 `:` 前缀的字符串可能误匹配到错误 provider（如 openrouter 的 `provider/model-name` id 格式），parentModel 已正确解析、无此风险。runner.ts 和 worker.ts SHALL 共用此函数。

#### Scenario: tier 模型命中

- **WHEN** agent `flagella` 声明 `tier: "fast"`，config 配置 `subagents.modelTiers.fast = "Astron:mini"`
- **THEN** `resolveSubagentModel` SHALL 返回 `resolveModel(registry, "Astron:mini")` 的结果
- **AND** SHALL NOT 尝试 parentModel 或 agent.model

#### Scenario: 无 tier 配置时 parentModel 优先于 agent.model

- **WHEN** agent 声明 `model: "deepseek/deepseek-v4-pro"` 且无 tier 配置
- **AND** parentModel 存在（父会话已解析的模型）
- **THEN** `resolveSubagentModel` SHALL 返回 parentModel（③）
- **AND** SHALL NOT 尝试 `resolveModel("deepseek/deepseek-v4-pro")`（④），因为该字符串可能误匹配到错误 provider
- **AND** 仅当 parentModel 为 undefined 时才尝试 agent.model

#### Scenario: parentModel 不存在时回退到 agent.model

- **WHEN** agent 声明 `model: "Astron:my-model"`（使用冒号语法，安全）
- **AND** parentModel 为 undefined
- **THEN** `resolveSubagentModel` SHALL 尝试 `resolveModel(registry, "Astron:my-model")`（④）
- **AND** 解析成功时返回结果，失败时继续尝试 extraFallback / fallback / global model

#### Scenario: 全部候选均失败

- **WHEN** agent 无 tier、无 model，且 parentModel 为 undefined，且 config 无 fallback 和 global model
- **THEN** `resolveSubagentModel` SHALL 返回 `undefined`
- **AND** 调用方（runner.ts / worker.ts）SHALL throw Error，消息包含 agent name 和已尝试的候选列表

#### Scenario: 精确覆盖优先于 tier

- **WHEN** config 同时配置了 `subagents.models.nucleus` 和 `subagents.modelTiers.powerful`，agent `nucleus` 的 tier 为 `powerful`
- **THEN** `resolveSubagentModel` SHALL 使用 `models.nucleus` 的值
- **AND** SHALL NOT 使用 `modelTiers.powerful` 的值

### Requirement: Agent tier frontmatter 字段

系统 SHALL 在 `AgentConfig` 类型新增可选字段 `tier?: "fast" | "standard" | "powerful"`，并在 `loadAgentsFromDir` 解析 frontmatter 时提取。内置 agents SHALL 声明 tier：flagella=fast、ribosome=standard、plasmid=standard、nucleus=powerful、lysosome=powerful。

#### Scenario: 解析合法 tier 字段

- **WHEN** agent frontmatter 含 `tier: fast`
- **THEN** `AgentConfig.tier` SHALL 为 `"fast"`
- **AND** `resolveSubagentModel` SHALL 使用该值查找 `config.subagents.modelTiers.fast`

#### Scenario: 非法 tier 值跳过 agent

- **WHEN** agent frontmatter 含 `tier: ultra` 或不属于 `"fast" | "standard" | "powerful"` 的取值
- **THEN** `loadAgentsFromDir` SHALL 视为非法、跳过该 agent
- **AND** SHALL stderr 输出 warn `agent <name> tier must be one of fast|standard|powerful, got "<value>"`

#### Scenario: 未声明 tier 保留 undefined

- **WHEN** agent frontmatter 未声明 `tier` 字段
- **THEN** `AgentConfig.tier` SHALL 为 `undefined`
- **AND** `resolveSubagentModel` SHALL 跳过 tier 映射步骤，直接尝试 agent.model

#### Scenario: 内置 agents tier 声明

- **WHEN** 系统加载 `BUILTIN_AGENTS`
- **THEN** `flagella.tier` SHALL 为 `"fast"`
- **AND** `ribosome.tier` SHALL 为 `"standard"`
- **AND** `plasmid.tier` SHALL 为 `"standard"`
- **AND** `nucleus.tier` SHALL 为 `"powerful"`
- **AND** `lysosome.tier` SHALL 为 `"powerful"`

