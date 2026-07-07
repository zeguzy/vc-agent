## ADDED Requirements

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
