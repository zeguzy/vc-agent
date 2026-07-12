## ADDED Requirements

### Requirement: File change tracking
When the AI agent modifies or creates a file, the system SHALL record the original content snapshot and track the change as "pending review" status.

#### Scenario: Agent edits existing file
- **WHEN** the agent's edit tool writes new content to an existing file
- **THEN** the system records the file's pre-edit content as a snapshot, writes the new content to disk, marks the file as "pending" in the review store, and emits a change event

#### Scenario: Agent creates new file
- **WHEN** the agent's write tool creates a new file that did not exist before
- **THEN** the system records an empty string as the original content snapshot, writes the new content to disk, marks the file as "pending" in the review store, and emits a change event

#### Scenario: Agent modifies already-pending file
- **WHEN** the agent modifies a file that already has "pending" status
- **THEN** the system updates the current content and re-generates hunks, but preserves the original snapshot from the first modification; the file remains "pending"

### Requirement: Accept file changes
The user SHALL be able to accept changes to a file, confirming the agent's modifications.

#### Scenario: Accept single file
- **WHEN** the user accepts a pending file
- **THEN** the file's status changes to "accepted", the on-disk content is preserved (agent's changes are kept), the file is removed from the pending list, and an event is emitted

#### Scenario: Accept all files
- **WHEN** the user accepts all pending files
- **THEN** all pending files are marked as "accepted", their on-disk content is preserved, and the pending list becomes empty

### Requirement: Reject file changes
The user SHALL be able to reject changes to a file, reverting to the original content.

#### Scenario: Reject single file (existing file)
- **WHEN** the user rejects a pending file that existed before the agent's changes
- **THEN** the file's content is restored from the original snapshot, the file's status changes to "rejected", and an event is emitted

#### Scenario: Reject single file (newly created file)
- **WHEN** the user rejects a pending file that was created by the agent (originalContent is empty)
- **THEN** the file is deleted from disk, the file's status changes to "rejected", and an event is emitted

#### Scenario: Reject all files
- **WHEN** the user rejects all pending files
- **THEN** each pending file is reverted or deleted according to the rules above, and the pending list becomes empty

### Requirement: Pending review bar in TUI
The TUI SHALL display a persistent bar above the input box showing the number of pending file changes.

#### Scenario: No pending changes
- **WHEN** there are no pending file changes
- **THEN** the pending review bar is not displayed

#### Scenario: Pending changes exist
- **WHEN** one or more files have "pending" status
- **THEN** a bar is displayed above the input box showing "N file(s) pending review" with the file names, and keyboard shortcuts to accept all (A) or reject all (R) or open review view (Enter)

### Requirement: Diff review view in TUI
The TUI SHALL provide a full-screen diff review view for inspecting and resolving file changes.

#### Scenario: Open diff review view
- **WHEN** the user presses the review shortcut key (Ctrl+R) or selects Enter on the pending review bar
- **THEN** a full-screen overlay opens showing the first pending file's diff, with navigation (n/p for next/previous file), accept (a), and reject (r) actions

#### Scenario: Navigate between files in review view
- **WHEN** the user presses n or p in the diff review view
- **THEN** the view switches to the next or previous pending file's diff, and the current file index is displayed (e.g., "2/5")

#### Scenario: Accept current file in review view
- **WHEN** the user presses 'a' in the diff review view
- **THEN** the current file is accepted, the view moves to the next pending file, and if no more pending files exist, the review view closes

#### Scenario: Reject current file in review view
- **WHEN** the user presses 'r' in the diff review view
- **THEN** the current file is rejected (reverted or deleted), the view moves to the next pending file, and if no more pending files exist, the review view closes

#### Scenario: Close review view without resolving
- **WHEN** the user presses Escape in the diff review view
- **THEN** the review view closes, and all files remain in their current status (pending files stay pending)
