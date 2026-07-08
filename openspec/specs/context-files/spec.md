# context-files Specification

## Purpose
TBD - context file discovery and system prompt assembly.
## Requirements
### Requirement: 发现并加载项目级 AGENTS.md

系统 SHALL 在启动时从当前工作目录（cwd）向上遍历目录树，查找第一个存在的 `AGENTS.md` 文件，并将其内容注入 system prompt。

#### Scenario: 项目根存在 AGENTS.md
- **WHEN** cwd 或任一祖先目录中存在 `AGENTS.md`
- **THEN** 系统 SHALL 读取该文件内容
- **AND** 将其以 `Instructions from: <filePath>` 为前缀注入 system prompt
- **AND** 不再搜索更上层的 `AGENTS.md`（首个匹配即停）

#### Scenario: 项目无 AGENTS.md 但有 CLAUDE.md
- **WHEN** 目录树中不存在 `AGENTS.md`，但存在 `CLAUDE.md`
- **THEN** 系统 SHALL 回退读取 `CLAUDE.md`，行为同 AGENTS.md

#### Scenario: 两者都不存在
- **WHEN** 目录树中既无 `AGENTS.md` 也无 `CLAUDE.md`
- **THEN** 系统 SHALL 不注入任何项目级上下文文件

### Requirement: 发现并加载全局 AGENTS.md

系统 SHALL 检查 `~/.config/openagent/AGENTS.md`，若存在则注入 system prompt。

#### Scenario: 全局 AGENTS.md 存在
- **WHEN** `~/.config/openagent/AGENTS.md` 文件存在
- **THEN** 系统 SHALL 读取并注入，优先级低于项目级 AGENTS.md（追加在其后）

#### Scenario: 全局不存在但 ~/.claude/CLAUDE.md 存在
- **WHEN** `~/.config/openagent/AGENTS.md` 不存在，但 `~/.claude/CLAUDE.md` 存在
- **THEN** 系统 SHALL 回退读取 `~/.claude/CLAUDE.md`

### Requirement: config.json instructions 字段

系统 SHALL 支持 `config.json` 中的 `instructions` 字段，允许显式指定额外的上下文文件路径、glob 模式和 HTTP(S) URL。

#### Scenario: 相对路径文件
- **WHEN** `instructions` 包含相对路径如 `"docs/standards.md"`
- **THEN** 系统 SHALL 从 cwd 向上搜索该文件（`findUp`），读取并注入

#### Scenario: ~/ 展开
- **WHEN** `instructions` 包含 `~/` 开头的路径如 `"~/my-rules.md"`
- **THEN** 系统 SHALL 将 `~` 展开为用户 home 目录，读取并注入

#### Scenario: glob 模式
- **WHEN** `instructions` 包含 glob 如 `"packages/*/AGENTS.md"`
- **THEN** 系统 SHALL 展开 glob，读取所有匹配文件，按路径排序后逐一注入

#### Scenario: HTTP(S) URL
- **WHEN** `instructions` 包含 `http://` 或 `https://` 开头的 URL
- **THEN** 系统 SHALL 通过 HTTP GET 获取内容（5 秒超时），失败则静默跳过
- **AND** 注入时标注 `Instructions from: <URL>`

#### Scenario: 路径不存在
- **WHEN** `instructions` 指定的文件路径不存在
- **THEN** 系统 SHALL 静默跳过，不阻塞启动

### Requirement: 目录层级动态上下文注入

系统 SHALL 提供 `resolve(filePath)` 方法，当读取某个文件时，从该文件所在目录向上遍历，查找每个父目录中的 `AGENTS.md` 并注入上下文。

#### Scenario: 文件路径关联的 AGENTS.md
- **WHEN** agent 读取 `/project/src/auth/login.ts`
- **THEN** 系统 SHALL 依次检查 `src/auth/AGENTS.md`、`src/AGENTS.md`、`AGENTS.md`
- **AND** 对每个存在的 `AGENTS.md`（非已加载的根 AGENTS.md 且非重复），读取内容并返回

#### Scenario: 同消息去重
- **WHEN** 同一 message ID 内多次触发 resolve
- **THEN** 系统 SHALL 不重复注入同一文件

### Requirement: system prompt 组装

系统 SHALL 将基础 prompt、全局 rules、项目 rules、instructions 文件按固定顺序组装为最终 system prompt。

#### Scenario: 完整组装
- **WHEN** 以上所有来源均存在内容
- **THEN** 最终 system prompt SHALL 按以下顺序拼接：
  1. Base system prompt（当前硬编码内容）
  2. 全局 AGENTS.md（如存在）
  3. 项目级 AGENTS.md（如存在）
  4. instructions 文件内容（按数组顺序）
- **AND** 每个外部来源以 `\n\nInstructions from: <path>\n` 为前缀

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

