## ADDED Requirements

### Requirement: Leader 可动态创建团队成员

系统 SHALL 在 team tool 中提供 `create-member` action，允许 leader（编排 LLM）动态创建团队成员。每个成员有独立身份：name（拟人名称）、role（职责描述）、goal（目标）、model（模型分配）。

#### Scenario: Leader 创建前端开发成员
- **WHEN** leader 调用 `team(action="create-member", name="Alice", role="前端开发", goal="实现用户登录页面", model="deepseek-v4-pro")`
- **THEN** SHALL 生成 member id（`mem_<8 char base32>`）
- **AND** SHALL 返回 `{memberId, name, status: "idle"}` 回执
- **AND** 成员 SHALL 被注册到 TeamSession 的 member registry

#### Scenario: Leader 创建成员时省略 model
- **WHEN** leader 调用 `team(action="create-member", name="Bob", role="后端开发", goal="实现用户 API")` 且不传 model
- **THEN** SHALL 使用 `config.teams.defaultWorkerModel` 作为默认模型
- **AND** 若 defaultWorkerModel 也为空，SHALL 使用 leader 当前模型

#### Scenario: 重名成员拒绝创建
- **WHEN** leader 尝试创建 name 已存在的成员
- **THEN** SHALL 返回错误 `"成员 <name> 已存在，请使用其他名字或先移除"`

### Requirement: 成员有独立身份和生命周期

每个 TeamMember SHALL 具备以下字段：id、name、role、goal、status（idle/working/done/error）、model、context（对话历史摘要）、createdAt。成员 SHALL 支持 `remove` 移除（释放资源）。

#### Scenario: 查看成员状态
- **WHEN** leader 调用 `team(action="list-members")`
- **THEN** SHALL 返回所有成员列表，每条包含：id、name、role、goal、status

#### Scenario: 移除空闲成员
- **WHEN** leader 调用 `team(action="remove-member", memberId="mem_xxx")` 且该成员状态为 idle 或 done
- **THEN** SHALL 从 registry 移除，返回 `"成员 Alice(mem_xxx) 已移除"`
- **AND** 若成员正在 working，SHALL 返回错误 `"成员正在工作中，请先 cancel"`

### Requirement: 成员名和角色由 leader 自主决定

系统 SHALL NOT 限制成员角色为预设类别。Leader 可自由指定 name 和 role 字符串。内置 agent 定义（flagella/ribosome/nucleus/plasmid/lysosome）SHALL 保留为"快捷模板"，leader 可通过 `create-member` 的 template 参数引用，也可完全自定义。

#### Scenario: 使用内置模板创建成员
- **WHEN** leader 调用 `team(action="create-member", name="Seeker", template="flagella", goal="探索代码库")`
- **THEN** SHALL 从内置 agent 定义复制 tools、systemPrompt、permissionMode 等配置
- **AND** SHALL 覆盖 name 和 goal 为 leader 指定的值

#### Scenario: 完全自定义成员
- **WHEN** leader 调用 `team(action="create-member", name="Architect", role="系统架构师", goal="设计系统架构", tools=["read","grep","find","bash"])`
- **THEN** SHALL 使用 leader 指定的 tools，不依赖任何模板
- **AND** systemPrompt SHALL 由 leader 指定的 role + goal 自动生成
