## ADDED Requirements

### Requirement: Member 工具注入
Member 创建时必须注入基础工具集，使其能独立执行任务。

#### Scenario: Member 创建时获得工具集
- **WHEN** leader 通过 team-edit (add-member) 创建 member
- **THEN** member 的 AgentSession 包含工具：read, bash, grep, find, member-read, self-edit, memory-write

#### Scenario: Member 不能获得危险工具
- **WHEN** member 被创建
- **THEN** member 不包含工具：edit, write, team-edit, team-read, question, subagent, member-edit

### Requirement: Member 工具权限
Member 工具受 permissionMode 控制，沿用 V1 Worker 的权限模型。

#### Scenario: default permissionMode 拒绝 edit/write
- **WHEN** member 的 permissionMode 为 "default"
- **THEN** edit 和 write 工具被拒绝（已在工具注入时排除）

#### Scenario: plan permissionMode 拒绝 edit/write/bash
- **WHEN** member 的 permissionMode 为 "plan"
- **THEN** edit、write、bash 工具被拒绝
