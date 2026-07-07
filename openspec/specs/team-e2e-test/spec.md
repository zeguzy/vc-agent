# team-e2e-test Specification

## Purpose
TBD - created by archiving change team-auto-test. Update Purpose after archive.
## Requirements
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

### Requirement: Discussion task lifecycle E2E test
The E2E test suite SHALL cover the full discussion task lifecycle via real LLM: create members → assign discussion task → coordinator drives multi-round member speaking → inter-member messaging → task status transitions to done. Tests are skipped by default and enabled with `RUN_LLM_TESTS=1`.

#### Scenario: Discussion task completes via coordinator
- **WHEN** the test creates 3 members via HttpClient, assigns a discussion task via `client.assignTask({type:"discussion"})`, and polls task status up to 180s
- **THEN** the task status SHALL transition from in_progress to done within the deadline, and at least one `discussion_evaluated` event SHALL be present in the JSONL log

#### Scenario: Discussion triggers inter-member messaging
- **WHEN** a discussion task is assigned and members complete initial turns
- **THEN** at least one member's inbox (queried via `client.fetchInbox(memberName)`) SHALL contain a message from another member, proving members communicate during the discussion

#### Scenario: Member status cycles during discussion
- **WHEN** a member completes a turn within a discussion task
- **THEN** the member status SHALL transition from active to idle (not done) to allow the coordinator to evaluate and potentially re-activate, which is observable via `client.fetchMember(name).status` over time

#### Scenario: Coordinator decision logged with round and action
- **WHEN** the coordinator evaluates a discussion round
- **THEN** the JSONL log entry for `discussion_evaluated` SHALL contain `taskId`, `round` (monotonically increasing within a task), `action` (one of "continue" / "complete"), and `reason`

#### Scenario: HttpClient assigns discussion task via type field
- **WHEN** `client.assignTask({ title, description, memberName, type: "discussion" })` is called
- **THEN** the returned `TaskState.type` SHALL be `"discussion"`, and the underlying task SHALL trigger discussion lifecycle (not execution single-turn completion)

### Requirement: Coordinator pure-function unit test
The unit test suite SHALL cover coordinator pure functions (`parseCoordinatorDecision`, `buildCoordinatorPrompt`, `collectRecentMessages`) without LLM dependency. These tests SHALL run by default (not gated by `RUN_LLM_TESTS`).

#### Scenario: parseCoordinatorDecision handles markdown-wrapped JSON
- **WHEN** `parseCoordinatorDecision` receives a string containing a fenced `json` code block with a valid continue decision
- **THEN** it SHALL return `{ action: "continue", nextSpeaker, instruction, reason }` with parsed fields

#### Scenario: parseCoordinatorDecision handles malformed JSON
- **WHEN** `parseCoordinatorDecision` receives a string with no parseable JSON
- **THEN** it SHALL return `{ action: "complete", reason: <descriptive error> }` rather than throwing

#### Scenario: buildCoordinatorPrompt includes task and member context
- **WHEN** `buildCoordinatorPrompt` is called with a CoordinatorInput containing task title, 3 members, and recent messages
- **THEN** the output SHALL contain the task title, each member's name and role, the round/maxRounds, and the JSON response format instruction

#### Scenario: collectRecentMessages deduplicates and sorts by timestamp
- **WHEN** `collectRecentMessages` reads multiple member inbox.jsonl files with overlapping messages (same from+to+timestamp)
- **THEN** it SHALL return deduplicated entries sorted by ascending timestamp, truncated to the limit

