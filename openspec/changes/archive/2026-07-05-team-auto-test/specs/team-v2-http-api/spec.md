## ADDED Requirements

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
The system SHALL provide RESTful HTTP endpoints for managing team tasks.

#### Scenario: Assign task via POST /team/tasks
- **WHEN** a POST request is sent to `/team/tasks` with body `{ title, description, memberId, priority? }`
- **THEN** the system SHALL assign a task to the member and return `TeamTask` JSON with status 200, or `{ error }` with status 400 if member not found or pool full

#### Scenario: List tasks via GET /team/tasks
- **WHEN** a GET request is sent to `/team/tasks`
- **THEN** the system SHALL return `{ tasks: TeamTask[] }` with status 200

#### Scenario: Get task status via GET /team/tasks/:id
- **WHEN** a GET request is sent to `/team/tasks/:id`
- **THEN** the system SHALL return `{ task: TeamTask }` with status 200, or `{ error: "task not found" }` with status 404

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
