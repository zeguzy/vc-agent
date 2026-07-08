## MODIFIED Requirements

### Requirement: Team orchestrator system prompt 注入

系统 SHALL 在 `src/context-files.ts` 加载链中条件性追加 team orchestrator system prompt 段落，指导主 agent 在收到适合 spawn 的需求时使用 `team` 工具而非同步 `subagent` 工具。该段落 SHALL 仅在 `Config.teams.enabled !== false` 且主 agent 处于 `"standard"` 模式（非 `"planner"`）时启用。

该 prompt 段 SHALL 包含工具分配指南（"Building Your Team" 板块），指导 leader 在创建成员时主动思考角色所需的工具和 skill：
- 工具能力说明：默认成员是只读的（read, bash, grep, find, memory, message），需显式指定 tools 参数才能编辑代码
- 角色工具映射指引：实现类成员 MUST 分配 edit + write；只读研究类成员可保持默认工具集
- Skill 分配指引：leader SHALL 查看注入的 skill 清单，为成员分配相关 skill

`team` 工具的 description 字段 SHALL 在开头醒目提示默认成员是只读的，需显式指定 tools 参数才能编辑代码。

#### Scenario: 加载 team orchestrator prompt
- **WHEN** 系统启动且 `Config.teams.enabled !== false` 且主 agent 当前模式为 `"standard"`
- **THEN** systemPrompt SHALL 在 base prompt 之后追加 team orchestrator 段，至少包含：
  - 异步委派对范式说明：当任务包含**多个独立的、并行可推进的**子工作时使用 `team.spawn`
  - spawn 后**继续推进**主路线工作，不要立刻 poll；当所有 worker 都到关键节点或最后聚合时再 `team.poll wait=true`
  - `subagent` 工具适用场景（**同步**要求立即拿到结果）与 `team` 工具适用场景（**异步**可继续推进）的区分准则
  - 失败处置：`team.poll` 看到 `error` 时由主 agent 决定 retry / 换 model 重 spawn
  - **工具分配指南**：默认成员只读，需显式分配 edit/write 才能编辑代码；角色-工具映射参考

#### Scenario: team orchestrator prompt 包含工具分配指南
- **WHEN** team orchestrator prompt 被加载
- **THEN** prompt SHALL 包含 "Building Your Team" 或等价板块
- **AND** SHALL 明确说明默认成员工具集是只读的（无 edit/write）
- **AND** SHALL 指导 leader 为代码实现类成员分配 edit + write 工具
- **AND** SHALL 提示 leader 查看注入的 skill 清单并为成员分配相关 skill

#### Scenario: team 工具 description 提示默认只读
- **WHEN** LLM 读取 team 工具定义
- **THEN** description SHALL 在开头包含醒目提示，说明新成员默认只读
- **AND** SHALL 说明需通过 tools 参数显式分配 edit/write 才能编辑代码

#### Scenario: planner 模式不启用 team prompt
- **WHEN** 主 agent 当前模式为 `"planner"`
- **THEN** SHALL NOT 加载 team orchestrator prompt（planner 只读模式，不应 spawn 后台 worker 改代码）

#### Scenario: 配置禁用 teams
- **WHEN** `Config.teams.enabled === false`
- **THEN** SHALL NOT 加载 team orchestrator prompt
- **AND** `team` 工具 SHALL 从 active tools 列表中移除，主 agent 看不到该工具

## ADDED Requirements

### Requirement: 成员工具定义完整性

系统 SHALL 在 `TeamManager.buildMemberCustomTools` 中，根据 `assignedTools` 数组中出现的工具名，为 openagent 自定义工具（edit, glob, todo, webfetch）创建对应的 `ToolDefinition`。这确保 Pi SDK 双名单约束得到满足：工具名在白名单中且存在对应的工具定义。

Pi SDK 内置工具（read, bash, write, grep, find）由 SDK 内部注册表自动注册，无需在 customTools 中创建定义。openagent 自定义工具（edit, glob, todo, webfetch, memory, message, mcp）必须在 customTools 中创建对应的 `ToolDefinition` 才能注册。

#### Scenario: 成员分配了 edit 工具时获得工具定义
- **WHEN** leader 通过 team 工具创建成员时指定 `tools=["read","bash","edit","write","grep","find"]`
- **THEN** `buildMemberCustomTools` SHALL 在返回的 ToolDefinition 数组中包含 edit 工具定义
- **AND** 成员 session SHALL 能调用 edit 工具进行代码编辑

#### Scenario: 成员未分配 edit 工具时不获得工具定义
- **WHEN** leader 通过 team 工具创建成员时使用默认工具集（未指定 tools）
- **THEN** `buildMemberCustomTools` SHALL NOT 包含 edit 工具定义
- **AND** 成员 session SHALL NOT 能调用 edit 工具

#### Scenario: 成员分配了 glob/todo/webfetch 工具时获得对应定义
- **WHEN** leader 通过 team 工具创建成员时指定 `tools=["read","glob","todo","webfetch"]`
- **THEN** `buildMemberCustomTools` SHALL 包含 glob、todo、webfetch 的 ToolDefinition
- **AND** 成员 session SHALL 能调用这些工具

#### Scenario: 成员的 edit 工具不弹确认界面
- **WHEN** 成员被分配了 edit 工具
- **THEN** edit ToolDefinition SHALL NOT 绑定 EditConfirmBridge（成员是 headless sub-session，无 TUI 确认界面）
- **AND** 成员 SHALL 直接执行编辑操作不弹确认

#### Scenario: 恢复成员时也创建完整工具定义
- **WHEN** TeamManager.restoreMembers 恢复一个已分配 edit 工具的成员
- **THEN** 恢复后的成员 session SHALL 包含 edit ToolDefinition
- **AND** 恢复后的成员 SHALL 能调用 edit 工具
