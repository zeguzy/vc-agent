## MODIFIED Requirements

### Requirement: SubagentMessageView improved rendering
SubagentMessageView SHALL be improved to display more compact, higher-density output aligned with opencode's inline style. Running state shows spinner + agent/category + streaming tail. Completed state shows checkmark + summary + cost + duration + model + category. Error state shows X + error message. Border padding reduced, key info on single lines where possible.

#### Scenario: Running subagent display
- **WHEN** a subagent tool invocation is running
- **THEN** SubagentMessageView shows spinner icon, agent name, category (if provided), description, and the last few lines of streaming output

#### Scenario: Completed subagent display with metadata
- **WHEN** a subagent tool invocation completes
- **THEN** SubagentMessageView shows done icon, agent name, category, model, summary text, cost ($X.XXXX), turns, and duration — on compact lines

#### Scenario: Markdown result rendering
- **WHEN** a subagent result uses Markdown + `<task_metadata>` format
- **THEN** the markdown portion renders via the existing markdown component, and `<task_metadata>` is extracted and displayed as structured metadata
