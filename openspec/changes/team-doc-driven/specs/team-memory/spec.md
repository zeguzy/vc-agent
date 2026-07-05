## ADDED Requirements

### Requirement: 团队记忆目录结构

系统 SHALL 在 `.openagent/team/` 目录下维护团队状态文件，结构如下：
- `TEAM.md`：团队索引文件，由 leader 维护
- `members/<name>.md`：成员索引文件（≤200 行），始终加载到 member 的 system prompt
- `members/<name>/<topic>.md`：成员 topic 记忆文件，带 YAML frontmatter（type/created/updated/tokens）
- `shared/<topic>.md`：团队共享记忆文件，带 YAML frontmatter（type=project 或 reference）

#### Scenario: 团队目录初始化
- **WHEN** TeamManager 首次创建（团队目录不存在）
- **THEN** SHALL 创建 `.openagent/team/`、`members/`、`shared/` 目录
- **AND** SHALL 创建初始 `TEAM.md` 包含 Mission、Members、Active Tasks、Important Notes、Shared Memory Index 段落

#### Scenario: 成员索引文件创建
- **WHEN** 新 member 被添加到团队
- **THEN** SHALL 创建 `members/<name>.md` 包含 Profile、Active Context、Memory Index、Recent Activity 段落
- **AND** SHALL 创建 `members/<name>/` 目录用于 topic 文件

### Requirement: 四类记忆类型

系统 SHALL 支持四种记忆类型，通过 YAML frontmatter 的 `type` 字段区分：

| type | 可见性 | 写入者 | 存放位置 |
|------|--------|--------|----------|
| user | 私有 | member 自己 | `members/<name>/` |
| feedback | 私有 | leader 或其他 member | `members/<name>/` |
| project | 团队共享 | 任意 member | `members/<name>/` 或 `shared/` |
| reference | 团队共享 | 任意 member | `members/<name>/` 或 `shared/` |

#### Scenario: 写入 user 类型记忆
- **WHEN** member 通过 `memory-write` 工具写入 `{type: "user", topic: "preferences", content: "..."}`
- **THEN** SHALL 写入到 `members/<name>/preferences.md`，frontmatter `type: user`
- **AND** SHALL 更新 `members/<name>.md` 的 Memory Index 段落添加对应条目

#### Scenario: 写入 project 类型共享记忆
- **WHEN** member 通过 `memory-write` 工具写入 `{type: "project", topic: "conventions", content: "...", shared: true}`
- **THEN** SHALL 写入到 `shared/conventions.md`，frontmatter `type: project`
- **AND** SHALL 更新 `TEAM.md` 的 Shared Memory Index 段落添加对应条目

#### Scenario: feedback 类型记忆由 leader 写入
- **WHEN** leader 通过 `memory-write` 工具写入 `{type: "feedback", member: "lysosome", topic: "code-review-feedback", content: "..."}`
- **THEN** SHALL 写入到 `members/lysosome/feedback.md`，frontmatter `type: feedback`
- **AND** SHALL 更新 `members/lysosome.md` 的 Memory Index 段落添加对应条目

### Requirement: 索引文件容量控制

系统 SHALL 保证成员索引文件（`members/<name>.md`）不超过 200 行。当超过限制时 SHALL 自动压缩：保留 Profile 段落 + Memory Index 段落 + Recent Activity 最近 20 条，其余段落摘要化。

#### Scenario: 索引超限自动压缩
- **WHEN** 成员索引文件行数 > 200
- **THEN** SHALL 触发自动压缩：保留 Profile + Memory Index + Recent Activity（最近 20 条）
- **AND** Active Context 段落 SHALL 被压缩为最近一次 compaction summary 的前 500 字符
- **AND** 压缩后文件 SHALL ≤ 200 行

#### Scenario: 索引未超限不压缩
- **WHEN** 成员索引文件行数 ≤ 200
- **THEN** SHALL NOT 触发自动压缩

### Requirement: Topic 文件 YAML frontmatter

系统 SHALL 为每个 topic 文件维护 YAML frontmatter，包含 `type`、`created`、`updated`、`tokens` 四个字段。

#### Scenario: 创建新 topic 文件
- **WHEN** `memory-write` 工具写入新的 topic 文件
- **THEN** SHALL 生成 frontmatter：`type` 取自参数、`created` 和 `updated` 为当前时间 ISO 8601、`tokens` 为内容估算 token 数

#### Scenario: 更新已有 topic 文件
- **WHEN** `memory-write` 工具写入已有 topic 文件
- **THEN** SHALL 保留 `type` 和 `created`，更新 `updated` 为当前时间、`tokens` 为新内容估算 token 数
