## MODIFIED Requirements

### Requirement: Perspective switching extended to subagent sessions
The existing `[`/`]` key perspective switching mechanism (handleMemberNav + activeMemberName) SHALL be extended to include subagent child sessions in the navigation cycle. The candidate list SHALL include: leader → team members → subagent sessions → leader (cycling).

#### Scenario: Switch to subagent perspective
- **WHEN** user presses `]` (nextMember) while subagent background tasks exist
- **THEN** the view cycles through leader → members → subagent sessions, showing the selected session's messages

#### Scenario: Real-time streaming in subagent view
- **WHEN** user is viewing a subagent session and the subagent is actively streaming
- **THEN** messages update in real-time with 120ms throttle, identical to the existing member streaming behavior (App.tsx:186-219)

#### Scenario: Input routing in subagent view
- **WHEN** user types input while viewing a subagent session
- **THEN** the input is sent to the subagent session via session.followUp() or session.prompt()

#### Scenario: Return to leader
- **WHEN** user presses Escape while viewing a child session
- **THEN** the view returns to the leader (main session)

### Requirement: Subagent perspective indicator
The InputBox SHALL indicate when the user is viewing a subagent's perspective, reusing the existing member prefix display mechanism.

#### Scenario: Perspective indicator display
- **WHEN** user is viewing a subagent session
- **THEN** the input box shows a prefix like "[subagent-name] " to indicate the active perspective, reusing the existing member indicator pattern
