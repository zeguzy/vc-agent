## ADDED Requirements

### Requirement: Team E2E test framework
The system SHALL provide an end-to-end test framework that starts a real HttpServer with mock AgentServer, tests via HTTP fetch, and asserts via SSE events and JSONL log files.

#### Scenario: Test setup creates real HTTP server
- **WHEN** a test suite initializes
- **THEN** the framework SHALL create a mock AgentServer (with V2 handler stubs) and a real HttpServer on a random port

#### Scenario: Test can call V2 API via fetch
- **WHEN** a test sends an HTTP request to the server
- **THEN** the request SHALL be routed to the correct AgentServer handler and return the handler's response

#### Scenario: Test can collect SSE events
- **WHEN** a test subscribes to `/events` SSE endpoint
- **THEN** the test SHALL receive team events (team_worker_event, team_orphans_cancelled, team_status_update) in real-time

### Requirement: Member lifecycle E2E test
The test suite SHALL cover the full member lifecycle: create → assign task → task complete → remove.

#### Scenario: Create member and assign task
- **WHEN** a member is created via POST /team/members and a task is assigned via POST /team/tasks
- **THEN** the member status SHALL change to "working" and the task status SHALL be "in_progress"

#### Scenario: Task completion updates member status
- **WHEN** the worker finishes (simulated by mock)
- **THEN** the member status SHALL change to "done" and the task status SHALL change to "done"

#### Scenario: Remove idle member succeeds
- **WHEN** a member with status "idle" is removed via DELETE /team/members/:id
- **THEN** the member SHALL no longer appear in the members list

### Requirement: Message communication E2E test
The test suite SHALL cover inter-member messaging: send → read inbox.

#### Scenario: Send message and read inbox
- **WHEN** member A sends a message to member B via POST /team/messages
- **THEN** member B's inbox (GET /team/inbox?memberId=B) SHALL contain the message

#### Scenario: Broadcast message to team
- **WHEN** member A sends a message with `to: "team"` via POST /team/messages
- **THEN** the message SHALL appear in all members' inbox

### Requirement: Cancel and cleanup E2E test
The test suite SHALL cover member cancellation and pool cleanup.

#### Scenario: Cancel all members
- **WHEN** POST /team/cancel is called
- **THEN** all running members SHALL be cancelled and the pool running count SHALL be 0

### Requirement: Log assertion in E2E tests
The test suite SHALL verify that team events are logged to JSONL files.

#### Scenario: Member creation logged
- **WHEN** a member is created
- **THEN** the JSONL log file SHALL contain a `member_status_changed` or `status_snapshot` event referencing the member
