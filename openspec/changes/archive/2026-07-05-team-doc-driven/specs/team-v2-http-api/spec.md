## MODIFIED Requirements

### Requirement: V2 Team Member HTTP API

系统 SHALL 修改 member HTTP API 以适配 TeamManager 接口。member CRUD 改为读写 `.openagent/team/` 下的 Markdown 文件。

#### Scenario: Create member via POST /team/members
- **WHEN** a POST request is sent to `/team/members` with body `{ name, role, goal, model? }`
- **THEN** the system SHALL create a new team member via TeamManager
- **AND** SHALL create `members/<name>.md` index file + `members/<name>/` directory
- **AND** SHALL return `{ member: { name, role, goal, status: "active" } }` with status 200

#### Scenario: List members via GET /team/members
- **WHEN** a GET request is sent to `/team/members`
- **THEN** the system SHALL read TEAM.md Members table and return `{ members: [...] }` with status 200

#### Scenario: Get member via GET /team/members/:name
- **WHEN** a GET request is sent to `/team/members/:name`
- **THEN** the system SHALL read `members/<name>.md` and return `{ member: { name, role, goal, status, ... } }` with status 200

#### Scenario: Remove member via DELETE /team/members/:name
- **WHEN** a DELETE request is sent to `/team/members/:name`
- **THEN** the system SHALL archive the member directory to `members/_archived/<name>/`
- **AND** SHALL dispose the member session
- **AND** SHALL return `{ ok: true }` with status 200

### Requirement: V2 Team Task HTTP API

系统 SHALL 修改 task HTTP API 以适配 TeamManager。task 状态由 TEAM.md Active Tasks 段落驱动。

#### Scenario: Assign task via POST /team/tasks
- **WHEN** a POST request is sent to `/team/tasks` with body `{ title, description, memberName, priority? }`
- **THEN** the system SHALL update TEAM.md Active Tasks with the new task
- **AND** SHALL inject L4 (Tasks) to the target member via steer/prompt
- **AND** SHALL return `{ task: { id, title, memberName, status: "assigned" } }` with status 200

#### Scenario: List tasks via GET /team/tasks
- **WHEN** a GET request is sent to `/team/tasks`
- **THEN** the system SHALL read TEAM.md Active Tasks and return `{ tasks: [...] }` with status 200

### Requirement: V2 Team Memory HTTP API

系统 SHALL 新增 memory 相关 HTTP API，支持读写 member 的 topic 记忆文件。

#### Scenario: Write member memory via POST /team/members/:name/memory
- **WHEN** a POST request is sent to `/team/members/:name/memory` with body `{ type, topic, content }`
- **THEN** the system SHALL write to `members/<name>/<topic>.md` with YAML frontmatter
- **AND** SHALL update `members/<name>.md` Memory Index
- **AND** SHALL return `{ ok: true }` with status 200

#### Scenario: Read member memory via GET /team/members/:name/memory/:topic
- **WHEN** a GET request is sent to `/team/members/:name/memory/:topic`
- **THEN** the system SHALL read `members/<name>/<topic>.md` and return the full content with status 200

## REMOVED Requirements

### Requirement: V2 Team Message HTTP API
**Reason**: member 间不再通过 inbox/message 通信，改为通过 TEAM.md 和 shared/ 目录间接协作
**Migration**: 使用 memory-write 向 shared/ 写入 project/reference 类型记忆实现团队知识共享

### Requirement: Agent mode HTTP API supports team and orchestrator
**Reason**: agent mode 概念保留但 API 不变，不属于本 change 的修改范围
**Migration**: 无需迁移，现有 /mode API 继续工作
