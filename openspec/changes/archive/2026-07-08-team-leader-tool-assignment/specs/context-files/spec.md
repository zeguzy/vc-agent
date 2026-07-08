## MODIFIED Requirements

### Requirement: subagent 工具的 agent list 通过 discoverAgents 动态生成并注入系统提示词

系统 SHALL 新增 `buildAvailableAgentsPrompt(cwd): string` 函数（位于 `src/agents/discover.ts`），调用现有的 `discoverAgents(cwd)` 拿到**所有** agent（5 个内置 + 用户在 `~/.config/openagent/agents/` 或 `<cwd>/.openagent/agents/` 定义的自定义 agent），生成 markdown 描述段。该段 SHALL 在 `appendSystemPromptFor`（`src/agent/session.ts`）中被加入 standard、orchestrator 和 team 模式的 `appendSystemPrompt` 返回数组。planner 模式 SHALL NOT 注入。`subagent` 工具的 `description` 字段 SHALL 移除详细 agent 描述，仅保留调用语法和一行动态索引。

在 team 模式下，系统 SHALL 同时调用 `buildAvailableSkillsPrompt(cwd)` 生成 skill 清单段并注入，使 leader 知道有哪些 skill 可分配给成员。

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

#### Scenario: planner 模式不注入 agent list

- **WHEN** 主 agent 处于 planner 模式（只读规划）
- **THEN** 系统 prompt SHALL NOT 包含 agent list 段落
- **AND** subagent 工具 SHALL 不在 active tools 白名单内

#### Scenario: team 模式注入 agent list 和 skill list

- **WHEN** 主 agent 处于 team 模式
- **THEN** 系统 prompt SHALL 包含 agent list 段（使 leader 知道可用 subagent）
- **AND** 系统 prompt SHALL 包含 skill list 段（使 leader 知道可分配的 skill）
- **AND** skill list SHALL 通过 `buildAvailableSkillsPrompt(cwd)` 从 `.opencode/skills/` 和全局 skill 目录动态生成

## ADDED Requirements

### Requirement: team 模式动态注入 skill 清单

系统 SHALL 新增 `discoverAvailableSkills(cwd): AvailableSkill[]` 函数（位于 `src/agents/discover.ts`），从 `<cwd>/.opencode/skills/*/SKILL.md` 和 `~/.config/openagent/skills/*/SKILL.md` 读取 skill 的 name + description frontmatter。系统 SHALL 新增 `buildAvailableSkillsPrompt(cwd): string | undefined` 函数，将 skill 列表格式化为 markdown 段落。

在 team 模式下，`appendSystemPromptFor` SHALL 调用 `buildAvailableSkillsPrompt(cwd)` 并将结果追加到 system prompt 数组。该段 SHALL 位于 static cacheable 区，在 agent list 之后。planner 和 standard 模式 SHALL NOT 注入 skill list（standard 模式 skill 已通过 SkillManager 自动加载，不需要在 prompt 中列出）。

#### Scenario: team 模式下 skill 清单可见

- **WHEN** 主 agent 处于 team 模式
- **AND** `<cwd>/.opencode/skills/harness/SKILL.md` 存在
- **THEN** 系统 prompt SHALL 包含 skill list 段
- **AND** 该段 SHALL 包含 harness skill 的 name + description
- **AND** leader SHALL 能在 team 工具调用中指定 `skills=["harness"]` 分配给成员

#### Scenario: 无 skill 时不注入空段

- **WHEN** 主 agent 处于 team 模式
- **AND** 不存在任何 skill 目录
- **THEN** `buildAvailableSkillsPrompt` SHALL 返回 `undefined`
- **AND** 系统 prompt SHALL NOT 包含空的 skill list 段

#### Scenario: standard 模式不注入 skill list

- **WHEN** 主 agent 处于 standard 或 orchestrator 模式
- **THEN** 系统 prompt SHALL NOT 包含 skill list 段（skill 已通过 SkillManager 自动加载到成员 session）

#### Scenario: 用户自定义 skill 在 team 模式系统提示词中可见

- **WHEN** 用户在 `~/.config/openagent/skills/my-skill/SKILL.md` 定义了自定义 skill
- **AND** 主 agent 处于 team 模式
- **THEN** skill list 段 SHALL 包含该自定义 skill 的 name + description
