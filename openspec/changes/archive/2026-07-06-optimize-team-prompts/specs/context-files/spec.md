## ADDED Requirements

### Requirement: 系统提示词关键位置标注 cache 边界文档注释

系统 SHALL 在 `src/agent/session.ts:appendSystemPromptFor` 和 `src/context-files.ts:loadSystemContext` 的关键位置添加 `// CACHE-STATIC` 和 `// CACHE-DYNAMIC` 注释，作为维护者文档。`CACHE-STATIC` 标注跨 turn 稳定的段（BASE_SYSTEM_PROMPT、全局/项目 AGENTS.md、instructions、ORCHESTRATOR/TEAM prompt、agent list）；`CACHE-DYNAMIC` 标注随状态变化的段（运行时 `session.steer` 注入的 task 描述、TEAM.md 摘要）。这些注释 SHALL NOT 强制任何运行时行为，仅用于提示维护者哪些段稳定、哪些会 bust cache。系统 SHALL NOT 因此调整加载顺序（当前顺序已正确）。

#### Scenario: appendSystemPromptFor 含 cache 注释

- **WHEN** 维护者打开 `src/agent/session.ts` 查看 `appendSystemPromptFor` 函数
- **THEN** SHALL 看到 `// CACHE-STATIC` 注释标注 ORCHESTRATOR_SYSTEM_PROMPT、TEAM_ORCHESTRATOR_PROMPT、agent list 段
- **AND** 这些注释 SHALL NOT 影响函数返回值或运行时行为

#### Scenario: loadSystemContext 含 cache 注释

- **WHEN** 维护者打开 `src/context-files.ts` 查看 `loadSystemContext` 函数
- **THEN** SHALL 看到 `// CACHE-STATIC` 注释标注 BASE_SYSTEM_PROMPT、AGENTS.md、instructions 段
- **AND** 这些注释 SHALL NOT 影响函数返回值或运行时行为

### Requirement: subagent 工具的 agent list 通过 discoverAgents 动态生成并注入系统提示词

系统 SHALL 新增 `buildAvailableAgentsPrompt(cwd): string` 函数（位于 `src/agents/discover.ts` 或 `src/agents/prompt-builder.ts`），调用现有的 `discoverAgents(cwd)` 拿到**所有** agent（5 个内置 + 用户在 `~/.config/openagent/agents/` 或 `<cwd>/.openagent/agents/` 定义的自定义 agent），生成 markdown 描述段。该段 SHALL 在 `appendSystemPromptFor`（`src/agent/session.ts` L105-113）中被加入 standard 和 orchestrator 模式的 `appendSystemPrompt` 返回数组；planner 和 team 模式 SHALL NOT 注入（这两个模式不调用 subagent）。`subagent` 工具的 `description` 字段 SHALL 移除详细 agent 描述，仅保留调用语法和一行动态索引。

#### Scenario: standard 模式下系统提示词包含动态 agent list

- **WHEN** 主 agent 进入 standard 或 orchestrator 模式
- **THEN** `appendSystemPromptFor` SHALL 调用 `buildAvailableAgentsPrompt(cwd)` 生成 agent list 段
- **AND** 该段 SHALL 列出所有 `discoverAgents(cwd)` 返回的 agent（含用户自定义）
- **AND** 该段 SHALL 位于 static cacheable 区（appendSystemPrompt 数组末尾）
- **AND** subagent 工具的 description 字段 SHALL NOT 重复这些详细描述

#### Scenario: 用户自定义 agent 在系统提示词中可见

- **WHEN** 用户在 `~/.config/openagent/agents/my-agent.md` 定义了自定义 agent
- **AND** 主 agent 处于 standard 或 orchestrator 模式
- **THEN** 系统 prompt 中的 agent list SHALL 包含该自定义 agent 的 name + description + 典型用例
- **AND** LLM SHALL 能调用 `subagent({ mode: "single", agent: "my-agent", ... })`

#### Scenario: subagent 工具 description 仅保留调用语法

- **WHEN** LLM 读取 subagent 工具定义
- **THEN** description SHALL 仅包含 mode 取值说明（single/parallel/chain）、参数结构、委托 prompt 模板要求（GOAL/CONTEXT/SCOPE）
- **AND** SHALL 包含一行索引（如 `Available agents: see system prompt for the full list.`）
- **AND** SHALL NOT 包含每个 agent 的详细描述段落（这些已移到系统提示词）

#### Scenario: planner 与 team 模式不注入 agent list

- **WHEN** 主 agent 处于 planner 模式（只读规划）或 team 模式（用 team 工具而非 subagent）
- **THEN** 系统 prompt SHALL NOT 包含 agent list 段落（这两个模式不调用 subagent）
- **AND** subagent 工具 SHALL 不在 active tools 白名单内

### Requirement: 只读 agent 全覆盖 noContextFiles 的测试保障

系统 SHALL 在 `tests/agents/runner.test.ts`（或同等测试文件）包含测试用例，验证所有内置只读 agent（flagella/nucleus/plasmid/lysosome）通过 `runSubagent` 调用时，其 `DefaultResourceLoader` 配置 SHALL 包含 `noContextFiles: true`、`noSkills: true`、`noExtensions: true`。该测试 SHALL 防止未来回归（如有人误改 runner.ts 移除这些开关）。

#### Scenario: 测试验证 flagella 不加载项目 AGENTS.md

- **WHEN** 测试调用 `runSubagent({ agent: flagella, task: "...", ... })`
- **THEN** 测试 SHALL 断言传入 `createAgentSession` 的 `resourceLoader` 配置含 `noContextFiles: true`
- **AND** SHALL 断言含 `noSkills: true` 和 `noExtensions: true`

#### Scenario: 测试覆盖所有 4 个只读 agent

- **WHEN** 运行 `bun test tests/agents/runner.test.ts`
- **THEN** 测试 SHALL 对 flagella、nucleus、plasmid、lysosome 各跑一次配置断言
- **AND** 任一 agent 缺失 `noContextFiles: true` SHALL 让测试失败
