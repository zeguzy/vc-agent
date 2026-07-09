## ADDED Requirements

### Requirement: Subagent tool DelegateTaskArgs parameters
The `subagent` tool SHALL support additional optional parameters aligned with oh-my-openagent's DelegateTaskArgs: `prompt` (string, full detailed prompt), `category` (optional string: quick/deep/ultrabrain/visual-engineering/artistry/unspecified-high/unspecified-low/writing), `subagent_type` (optional string: explore/librarian/oracle/metis/momus etc.), `run_in_background` (boolean, default false), `task_id` (optional string, continuation session id ses_...), `command` (optional string), `load_skills` (optional string[]). These parameters SHALL be optional and backward-compatible with existing calls.

#### Scenario: Subagent with category and skills
- **WHEN** agent calls subagent tool with mode="single", agent="sisyphus-junior", prompt="Fix the type error", category="quick", load_skills=["git-master"]
- **THEN** system creates a child AgentSession with the git-master skill content injected via resourceLoader, and uses category="quick" as metadata in the result

#### Scenario: Subagent with subagent_type
- **WHEN** agent calls subagent tool with subagent_type="explore", prompt="Find auth implementations"
- **THEN** system resolves subagent_type to the corresponding agent config and executes

#### Scenario: Backward compatibility
- **WHEN** agent calls subagent tool with mode="single", agent="ribosome", description="Fix bug" (no new parameters)
- **THEN** system works identically to current behavior

### Requirement: Subagent async execution mode
When `run_in_background=true`, the subagent tool SHALL create an independent AgentSession, prompt it, and immediately return a background task ID (bg_xxx) without waiting for completion. Completion notification SHALL reuse the existing `member_done` → steer/prompt injection mechanism.

#### Scenario: Async task dispatch
- **WHEN** agent calls subagent tool with run_in_background=true, prompt="Research auth patterns"
- **THEN** system creates an AgentSession, prompts it, returns bg_xxx task ID immediately

#### Scenario: Async completion notification
- **WHEN** an async subagent task's session completes
- **THEN** system injects a completion note into the parent session via steer (if streaming) or prompt (if idle), using the existing notification path

#### Scenario: Async task cancellation on session change
- **WHEN** the parent session changes (rebind) while async subagent tasks are running
- **THEN** system cancels orphaned subagent sessions via the existing cancelOrphansOnSessionChange mechanism

### Requirement: Background task management tools
The system SHALL provide `background_output` and `background_cancel` tools for managing async subagent tasks.

#### Scenario: Get background task output
- **WHEN** agent calls background_output with task_id="bg_xxx"
- **THEN** system returns the current output from the background task's session

#### Scenario: Cancel background task
- **WHEN** agent calls background_cancel with task_id="bg_xxx"
- **THEN** system aborts the background task's session and removes it from registry

### Requirement: Subagent session continuation
When `task_id` is provided (ses_... format), the subagent tool SHALL resume the existing child session with the new prompt using `session.followUp()`, preserving full conversation context.

#### Scenario: Task continuation
- **WHEN** agent calls subagent tool with task_id="ses_abc123", prompt="Also fix the test"
- **THEN** system resumes the existing subagent session ses_abc123 with the new prompt, preserving conversation context
