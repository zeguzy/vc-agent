## Why

Team 模式的 leader 从不给成员分配工具和 skill。根因是 4 层缺陷链：(1) leader 的系统提示词 `TEAM_ORCHESTRATOR_PROMPT` 对 tool/skill/mcp 分配零指引——leader 不知道默认成员是只读的（无 edit/write）；(2) `injectAgentList` 只列 subagent，不列 skill，leader 不知道有哪些 skill 可分配；(3) **更深的 bug**：即使 leader 正确传了 `tools=["edit","glob","todo"]`，`buildMemberCustomTools()` 也只创建 memory+message+mcp 的工具定义，edit/glob/todo/webfetch 的 ToolDefinition 不存在，Pi SDK 静默丢弃。结果是：即使修了提示词，成员依然用不了这些工具。

行业调研（LobeHub/CrewAI/AWS SmartResolve 等 7 个框架）证实：成熟的 multi-agent 系统都在 leader 提示词中嵌入工具-角色映射表、强制全量上下文注入、动态能力清单。openagent 当前在这三个维度上都缺失。

## What Changes

- **重构 `TEAM_ORCHESTRATOR_PROMPT`**：新增 "Building Your Team" 板块，包含工具分配指南、工具-角色映射表、"创建实现类成员必须分配 edit+write" 规则
- **`injectAgentList` 注入 skill 清单**：team 模式下同时枚举 `.opencode/skills/` 下的 skill，让 leader 知道有哪些可分配
- **`buildMemberCustomTools` 补全工具定义**：根据 assignedTools 中出现的工具名，动态创建 edit/glob/todo/webfetch 的 ToolDefinition，使 Pi SDK 不再静默丢弃这些工具名
- **`team` 工具 description 增强**：在工具描述中强调默认成员是只读的，需显式分配工具才能编辑代码

## Non-goals

- **不修 legacy Worker 路径**（`src/teams/worker.ts`）：Worker 是遗留实现，manager-v2 是当前路径。Worker.create() 不传 customTools 且 noSkills:true 写死，修它投入产出比低
- **不引入动态能力清单（Capability Roster）**：每次成员变更后在 leader 上下文注入团队快照是好功能，但属于增强而非修复，留待后续 change
- **不改成员创建后的工具更新机制**：本次只解决"创建时工具未分配"的问题，不支持运行时动态增减成员工具
- **不改 MCP 工具作用域**：当前 per-member MCP scoping 已在 buildMemberCustomTools 中实现，不在本次范围

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `team-orchestration`: Leader 提示词新增工具分配指南板块；`buildMemberCustomTools` 补全 edit/glob/todo/webfetch 工具定义
- `context-files`: team 模式下 `injectAgentList` 注入 skill 清单

## Impact

- **`src/context-files.ts`**：TEAM_ORCHESTRATOR_PROMPT 重构（新增 Building Your Team 板块）
- **`src/agent/session.ts`**：`injectAgentList` / `appendSystemPromptFor` 注入 skill 清单
- **`src/teams/manager-v2.ts`**：`buildMemberCustomTools` 补全工具定义工厂
- **`src/tools/team.ts`**：工具 description 增强（强调默认只读）
- **`src/teams/context.ts`**：`buildToolContractLayer` 可能需要适配新增的工具类型
- **测试**：新增 unit test 覆盖 buildMemberCustomTools 的工具定义完整性
