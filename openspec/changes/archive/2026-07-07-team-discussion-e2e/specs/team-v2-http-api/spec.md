## MODIFIED Requirements

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
