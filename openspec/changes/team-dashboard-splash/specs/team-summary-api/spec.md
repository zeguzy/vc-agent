## ADDED Requirements

### Requirement: AgentClient 团队摘要接口

系统 SHALL 在 AgentClient 接口新增 `listGoals()`、`readTeamMd()`、`listTeamSummaries()` 三个方法。

#### Scenario: listGoals 返回当前团队目标

- **WHEN** 调用 `client.listGoals(filter?)`
- **THEN** 系统 SHALL 返回当前团队的 Goal 数组
- **AND** filter 参数 SHALL 支持按 status 过滤
- **AND** 无 filter 时 SHALL 返回所有 goals

#### Scenario: readTeamMd 返回当前团队结构

- **WHEN** 调用 `client.readTeamMd()`
- **THEN** 系统 SHALL 返回当前团队的 TeamMdStructure 对象
- **AND** TeamMdStructure SHALL 包含 mission、goals、members、activeTasks、importantNotes、sharedMemoryIndex

#### Scenario: listTeamSummaries 返回跨 session 团队摘要

- **WHEN** 调用 `client.listTeamSummaries()`
- **THEN** 系统 SHALL 返回 TeamSummary 数组
- **AND** 每个 TeamSummary SHALL 包含：sessionId、sessionName、mission、memberCount、activeCount、goalCount、taskCount
- **AND** 系统 SHALL 扫描 `~/.config/openagent/team/` 下的所有子目录
- **AND** 每个子目录名 SHALL 作为 sessionId
- **AND** 系统 SHALL 读取每个子目录的 TEAM.md 获取摘要信息
- **AND** 系统 SHALL 从 sessions.db 获取 sessionName
- **AND** 无 TEAM.md 或空团队的目录 SHALL 被过滤

### Requirement: InProcessClient 透传实现

系统 SHALL 在 InProcessClient 中透传 AgentServer 的对应 handler。

#### Scenario: listGoals 透传

- **WHEN** InProcessClient.listGoals() 被调用
- **THEN** 系统 SHALL 调用 `server.handleListGoals(filter)` 并返回结果

#### Scenario: readTeamMd 透传

- **WHEN** InProcessClient.readTeamMd() 被调用
- **THEN** 系统 SHALL 调用 `server.handleReadTeamMd()` 并返回结果

#### Scenario: listTeamSummaries 透传

- **WHEN** InProcessClient.listTeamSummaries() 被调用
- **THEN** 系统 SHALL 调用 `server.handleListTeamSummaries()` 并返回结果

### Requirement: AgentServer handler 实现

系统 SHALL 在 AgentServer 中新增 handleListGoals、handleReadTeamMd、handleListTeamSummaries 三个 handler。

#### Scenario: handleListGoals 实现

- **WHEN** handleListGoals(filter) 被调用
- **THEN** 系统 SHALL 调用 `this.teamManager.listGoals(filter)` 并返回结果

#### Scenario: handleReadTeamMd 实现

- **WHEN** handleReadTeamMd() 被调用
- **THEN** 系统 SHALL 调用 `this.teamManager.files.readTeamMd()` 并返回结果

#### Scenario: handleListTeamSummaries 实现

- **WHEN** handleListTeamSummaries() 被调用
- **THEN** 系统 SHALL 扫描 `teamDir()` 下的子目录
- **AND** 对每个子目录读取 TEAM.md
- **AND** 从 sessions.db 查询 sessionName
- **AND** 返回 TeamSummary 数组

### Requirement: HttpClient REST 端点

系统 SHALL 在 HttpClient 中新增 3 个 GET 端点对应。

#### Scenario: GET /team/goals

- **WHEN** HttpClient.listGoals() 被调用
- **THEN** 系统 SHALL 发送 GET 请求到 `/team/goals`
- **AND** 返回 Goal 数组

#### Scenario: GET /team/md

- **WHEN** HttpClient.readTeamMd() 被调用
- **THEN** 系统 SHALL 发送 GET 请求到 `/team/md`
- **AND** 返回 TeamMdStructure 对象

#### Scenario: GET /team/summaries

- **WHEN** HttpClient.listTeamSummaries() 被调用
- **THEN** 系统 SHALL 发送 GET 请求到 `/team/summaries`
- **AND** 返回 TeamSummary 数组
