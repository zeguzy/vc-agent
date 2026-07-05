## MODIFIED Requirements

### Requirement: Member 创建注入工具集
Member 创建流程变更：从 `tools: []` 改为注入基础工具集 + 团队工具子集。

#### Scenario: createMember 注入工具
- **WHEN** TeamManager.createMember() 被调用
- **THEN** 创建 AgentSession 时传入工具集：[read, bash, grep, find, member-read, self-edit, memory-write]，并传入对应的 customTools 定义

### Requirement: TeamManagerLike 接口扩展
TeamManagerLike 接口新增生命周期控制和通信方法。

#### Scenario: TeamManagerLike 包含新方法
- **WHEN** 检查 TeamManagerLike 接口
- **THEN** 包含：pauseMember(name), resumeMember(name), cancelMember(name), directMember(name, kind, payload)

### Requirement: MemberState.status 扩展
MemberState.status 类型新增 "paused" 和 "cancelled" 值。

#### Scenario: MemberState.status 包含新值
- **WHEN** 检查 MemberState.status 类型
- **THEN** 类型为 "active" | "idle" | "done" | "error" | "paused" | "cancelled"

### Requirement: AgentClient 接口扩展
AgentClient 新增 pauseMember/resumeMember/cancelMember/directMember 方法。

#### Scenario: InProcessClient 实现新方法
- **WHEN** 调用 client.pauseMember(name)
- **THEN** 调用 server.handlePauseMember(name)

#### Scenario: HttpClient 实现新方法
- **WHEN** 调用 client.pauseMember(name)
- **THEN** 发送 PUT /team/members/:name/pause
