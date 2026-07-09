## ADDED Requirements

### Requirement: TaskRegistry for background subagent tracking
The system SHALL maintain a TaskRegistry that tracks active background subagent tasks by ID (bg_xxx), storing: session reference, parent session ID, description, status (pending/running/completed/error/cancelled), timestamps, and agent/category metadata.

#### Scenario: Task registration
- **WHEN** a subagent task is dispatched with run_in_background=true
- **THEN** TaskRegistry creates a bg_xxx entry with status="running", storing the child session reference and parent session ID

#### Scenario: Task completion tracking
- **WHEN** a background subagent task's session emits agent_end
- **THEN** TaskRegistry updates the entry status to "completed" and stores the result summary

#### Scenario: Task cleanup
- **WHEN** a background task is cancelled or the parent session is disposed
- **THEN** TaskRegistry removes the entry and disposes the child session

### Requirement: Async completion via existing steer mechanism
Background subagent task completion SHALL be notified to the parent session using the existing `member_done` → steer/prompt injection path in AgentServer.

#### Scenario: Completion notification to streaming parent
- **WHEN** a background subagent completes and the parent session is streaming
- **THEN** system calls parent session.steer() with a completion note containing task description, status, summary, and cost

#### Scenario: Completion notification to idle parent
- **WHEN** a background subagent completes and the parent session is idle
- **THEN** system calls parent session.prompt() with a completion note

### Requirement: Structured result format
Sync subagent results SHALL use Markdown + `<task_metadata>` format aligned with oh-my-openagent's buildSyncTaskCompletion.

#### Scenario: Markdown result format
- **WHEN** a sync subagent task completes
- **THEN** the tool result is formatted as: "Task completed in Xs.\n\nAgent: name (category: cat)\nModel: provider/model\n\n---\n\n[result text]\n\n<task_metadata>\nsession_id: ses_xxx\ntask_id: bg_xxx\nsubagent: name\ncategory: cat\n</task_metadata>"
