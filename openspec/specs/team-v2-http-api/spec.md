# team-v2-http-api Specification

## Purpose
TBD - created by archiving change team-auto-test. Update Purpose after archive.
## Requirements
### Requirement: V2 Team Member HTTP API
The system SHALL provide RESTful HTTP endpoints for managing team members.

#### Scenario: Create member via POST /team/members
- **WHEN** a POST request is sent to `/team/members` with body `{ name, role, goal, model?, tools?, systemPrompt? }`
- **THEN** the system SHALL create a new team member and return `TeamMember` JSON with status 200

#### Scenario: List members via GET /team/members
- **WHEN** a GET request is sent to `/team/members`
- **THEN** the system SHALL return `{ members: TeamMember[] }` with status 200

#### Scenario: Get member via GET /team/members/:id
- **WHEN** a GET request is sent to `/team/members/:id`
- **THEN** the system SHALL return `{ member: TeamMember }` with status 200, or `{ error: "member not found" }` with status 404

#### Scenario: Remove member via DELETE /team/members/:id
- **WHEN** a DELETE request is sent to `/team/members/:id`
- **THEN** the system SHALL remove the member and return `{ ok: true }` with status 200, or `{ error: "member ... is currently working" }` with status 400 if member is working

### Requirement: V2 Team Task HTTP API
The system SHALL provide RESTful HTTP endpoints for managing team tasks. The `POST /team/tasks` endpoint SHALL accept an optional `type` field to distinguish execution tasks (default) from discussion tasks.

#### Scenario: Assign task via POST /team/tasks
- **WHEN** a POST request is sent to `/team/tasks` with body `{ title, description, memberName, priority? }`
- **THEN** the system SHALL assign an execution task (default `type`) to the member and return `TaskState` JSON with status 200, or `{ error }` with status 400 if member not found or member status does not allow task assignment

#### Scenario: Assign discussion task with explicit type
- **WHEN** a POST request is sent to `/team/tasks` with body `{ title, description, memberName, type: "discussion" }`
- **THEN** the system SHALL assign a discussion task to the member, set `task.type` to `"discussion"`, and return `TaskState` JSON with `type: "discussion"` and status 200

#### Scenario: Assign execution task with explicit type
- **WHEN** a POST request is sent to `/team/tasks` with body `{ title, description, memberName, type: "execution" }`
- **THEN** the system SHALL assign an execution task to the member, set `task.type` to `"execution"`, and return `TaskState` JSON with `type: "execution"` and status 200

#### Scenario: Omitted type defaults to execution
- **WHEN** a POST request is sent to `/team/tasks` without a `type` field
- **THEN** the resulting `TaskState.type` SHALL be `"execution"`

#### Scenario: Reject invalid type value
- **WHEN** a POST request is sent to `/team/tasks` with `type` set to a value other than `"execution"`, `"discussion"`, or undefined (e.g. `"unknown"` or a number)
- **THEN** the system SHALL return `{ error: "invalid type" }` with status 400, and SHALL NOT create a task

#### Scenario: List tasks via GET /team/tasks
- **WHEN** a GET request is sent to `/team/tasks`
- **THEN** the system SHALL return `{ tasks: TaskState[] }` with status 200

#### Scenario: Get task status via GET /team/tasks/:id
- **WHEN** a GET request is sent to `/team/tasks/:id`
- **THEN** the system SHALL return `{ task: TaskState }` with status 200, or `{ error: "task not found" }` with status 404

### Requirement: V2 Team Message HTTP API
The system SHALL provide RESTful HTTP endpoints for inter-member communication.

#### Scenario: Send message via POST /team/messages
- **WHEN** a POST request is sent to `/team/messages` with body `{ from, to, content }`
- **THEN** the system SHALL send the message and return `{ ok: true }` with status 200, or `{ error }` with status 400 if sender/recipient not found or rate limit exceeded

#### Scenario: Read inbox via GET /team/inbox
- **WHEN** a GET request is sent to `/team/inbox?memberId=<id>`
- **THEN** the system SHALL return `{ messages: TeamMessage[] }` with status 200
- **WHEN** a GET request is sent to `/team/inbox` without memberId
- **THEN** the system SHALL return all messages with status 200

### Requirement: Agent mode HTTP API supports team and orchestrator
The POST /mode endpoint SHALL accept `"team"` and `"orchestrator"` in addition to `"standard"` and `"planner"`.

#### Scenario: Set team mode via POST /mode
- **WHEN** a POST request is sent to `/mode` with body `{ mode: "team" }`
- **THEN** the system SHALL set the agent mode to team and return `{ ok: true }`

### Requirement: HttpClient V2 methods implemented
The `HttpClient` class SHALL implement all V2 team methods (createMember, removeMember, getMember, listMembers, assignTask, listTasks, taskStatus, sendMessage, readInbox) by calling the corresponding HTTP endpoints.

#### Scenario: HttpClient createMember calls POST /team/members
- **WHEN** `client.createMember({ name, role, goal })` is called
- **THEN** the client SHALL send a POST request to `/team/members` and return the `TeamMember` result

#### Scenario: HttpClient listMembers calls GET /team/members
- **WHEN** `client.listMembers()` is called
- **THEN** the client SHALL send a GET request to `/team/members` and return the `TeamMember[]` result

