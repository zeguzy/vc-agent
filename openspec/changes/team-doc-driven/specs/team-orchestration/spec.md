## MODIFIED Requirements

### Requirement: team 工具暴露六个工具替代 spawn/poll/cancel

系统 SHALL 用六个独立工具替代现有的单一 `team` 工具（spawn/poll/cancel action 路由）：

| 工具 | 用途 | 可用者 |
|------|------|--------|
| `team-read` | 读取 TEAM.md 全文 | leader, member |
| `team-edit` | 编辑 TEAM.md（Mission/Members/Active Tasks/Important Notes） | leader only |
| `member-read` | 读取 member .md 索引 + topic 文件 | leader, member（自己） |
| `member-edit` | 编辑 member .md 索引 | leader only |
| `self-edit` | member 编辑自己的 .md 索引 | member only |
| `memory-write` | 写入 topic 记忆文件 | leader, member（自己） |

#### Scenario: team-read 读取团队状态
- **WHEN** leader 或 member 调用 `team-read` 工具
- **THEN** SHALL 返回 `.openagent/team/TEAM.md` 的全文内容
- **AND** member 调用时 SHALL 仅返回 Members 表中自己的行 + Active Tasks + Important Notes（隐藏其他 member 的私有信息）

#### Scenario: team-edit 编辑团队状态
- **WHEN** leader 调用 `team-edit` 工具，参数 `{section: "mission", content: "..."}`
- **THEN** SHALL 更新 TEAM.md 对应段落的内容
- **AND** SHALL 通知所有 active member（steer `[TEAM Update]`）

#### Scenario: member-read 读取成员记忆
- **WHEN** leader 调用 `member-read`，参数 `{name: "lysosome"}`
- **THEN** SHALL 返回 `members/lysosome.md` 索引全文
- **WHEN** leader 调用 `member-read`，参数 `{name: "lysosome", topic: "preferences"}`
- **THEN** SHALL 返回 `members/lysosome/preferences.md` 全文

#### Scenario: member-read 成员读取自己
- **WHEN** member 调用 `member-read` 无参数
- **THEN** SHALL 返回自己的 `.md` 索引全文
- **WHEN** member 调用 `member-read`，参数 `{topic: "preferences"}`
- **THEN** SHALL 返回自己的 `preferences.md` 全文

#### Scenario: member-edit leader 编辑成员索引
- **WHEN** leader 调用 `member-edit`，参数 `{name: "lysosome", section: "profile", content: "..."}`
- **THEN** SHALL 更新 `members/lysosome.md` 对应段落

#### Scenario: self-edit 成员编辑自己
- **WHEN** member 调用 `self-edit`，参数 `{section: "active-context", content: "..."}`
- **THEN** SHALL 更新自己的 `.md` 索引对应段落

#### Scenario: memory-write 写入记忆
- **WHEN** member 调用 `memory-write`，参数 `{type: "user", topic: "preferences", content: "..."}`
- **THEN** SHALL 写入 `members/<name>/preferences.md`（含 YAML frontmatter）
- **AND** SHALL 更新 member .md 索引的 Memory Index 段落

#### Scenario: 非法工具调用被拒绝
- **WHEN** member 尝试调用 `team-edit`
- **THEN** SHALL 返回 `{isError: true, content: "team-edit is only available to the leader"}`
- **WHEN** member 尝试 `member-read` 其他 member 的私有 topic（type=user/feedback）
- **THEN** SHALL 返回 `{isError: true, content: "cannot read other member's private memory"}`

### Requirement: Team orchestrator system prompt 注入

系统 SHALL 在 `src/context-files.ts` 加载链中条件性追加 team orchestrator system prompt，指导 leader 使用新工具集管理团队。该段落 SHALL 仅在 `Config.teams.enabled !== false` 且主 agent 处于 `"standard"` 或 `"team"` 模式时启用。

#### Scenario: 加载 team orchestrator prompt
- **WHEN** 系统启动且 `Config.teams.enabled !== false` 且主 agent 当前模式为 `"team"`
- **THEN** systemPrompt SHALL 追加 team orchestrator 段，包含：
  - 使用 `team-read` 了解团队状态
  - 使用 `team-edit` 分配任务、更新 Mission
  - 使用 `member-read` 了解成员状态
  - 使用 `memory-write` 给成员写反馈
  - member 完成任务后自动收到通知（steer/prompt），leader 决定是否分配新任务
  - 防无限循环：只在有明确新任务时分配，不因 member 完成而自动分配

#### Scenario: planner 模式不启用 team prompt
- **WHEN** 主 agent 当前模式为 `"planner"`
- **THEN** SHALL NOT 加载 team orchestrator prompt
