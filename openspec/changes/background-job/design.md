## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                     AgentServer                               │
│                                                               │
│  ┌──────────┐     ┌───────────────────┐                      │
│  │ session  │     │ backgroundJobSvc  │ ← new                │
│  │ (main)   │     │  .jobs: Map<id,   │                      │
│  │          │     │    ActiveJob>     │                       │
│  └────┬─────┘     └────────┬──────────┘                      │
│       │                    │                                   │
│       │  injectResult      │  start/wait/cancel/promote/list  │
│       │◄───────────────────┤                                   │
│       │                    │                                   │
│  ┌────┴────────────────────┴────────────────────┐             │
│  │              TUI (App.tsx)                    │             │
│  │                                               │             │
│  │  backgroundJobs: ActiveJob[]                  │             │
│  │                                               │             │
│  │  displayMessages:                             │             │
│  │    [...mainMsgs, ...bgJobCards]               │             │
│  │                                               │             │
│  │  Ctrl+B: promote current foreground task      │             │
│  └───────────────────────────────────────────────┘             │
└──────────────────────────────────────────────────────────────┘
```

## Data Flow

### Background Subagent Start Flow

```
Agent calls task(background=true, agent="search", description="find auth patterns")
    │
    ▼
SubagentTool.execute()
    ├── 1. Permission check (ctx.ask)
    ├── 2. Depth check (subagent_depth ≤ 1)
    ├── 3. Create child session via createAgentSession()
    │       - parentID = current session ID
    │       - Same cwd, derived tools, subagent model
    ├── 4. backgroundJobSvc.start({
    │       id: childSession.sessionId,
    │       type: "subagent",
    │       title: description,
    │       run: () => runSubagent(agent, task, childSession)
    │     })
    ├── 5. Register completion callback:
    │       backgroundJobSvc.wait(id) → injectResult(parentSession, result)
    └── 6. Return immediately:
            { content: "Background task started", task_id: id, status: "running" }
```

### Background Task Completion Flow

```
runSubagent() finishes
    │
    ▼
BackgroundJobService settles the job
    ├── 1. Update job.status = "completed" | "error"
    ├── 2. Store job.output = result text
    ├── 3. Fire completion callback
    │
    ▼
injectResult(parentSession, result)
    ├── If parent session streaming → steer(notification)
    ├── If parent session idle → inject synthetic message
    │       synthetic: true, type: "text"
    │       content: "[Background task completed: {title}]\n{output}"
    └── TUI: update bgJobCards (status → done, show result)
```

### Promote Flow (Ctrl+B)

```
User presses Ctrl+B while foreground subagent is running
    │
    ▼
TUI: handlePromote()
    ├── 1. Find current foreground tool execution (from isRunning state)
    ├── 2. backgroundJobSvc.promote(foregroundTaskId)
    │       - Mark job.metadata.background = true
    │       - Fire onPromote callback
    │       - Release Deferred.promoted
    ├── 3. Foreground tool execution returns backgroundResult()
    │       → Main agent resumes with "task moved to background"
    └── 4. TUI: show bg task card in message list
```

### /btw Flow (based on BackgroundJobService)

```
User types /btw
    │
    ▼
Command handler
    ├── 1. Promote current foreground task to background
    │       (if agent is running, promote it)
    ├── 2. If no running task, just mark session as "background"
    │       and let it continue independently
    ├── 3. Create new empty AgentSession (side conversation)
    │       with awareness prompt
    ├── 4. TUI: switch view to side session
    │       (same view-switch pattern as before)
    └── 5. When background job completes:
            injectResult(mainSession, result) → visible in main messages
            Side session gets awareness note via steer
```

## Key Design Decisions

### 1. BackgroundJobService as standalone service

**Decision**: Separate service class, not embedded in AgentServer

**Rationale**:
- Single responsibility: AgentServer already 700+ lines
- Testable in isolation (unit tests for lifecycle)
- Reusable by both subagent tool and /btw command
- Matches OpenCode's BackgroundJob.Service pattern

### 2. Task ID = Session ID

**Decision**: Background job ID is the child session's session ID

**Rationale**:
- No need for separate ID namespace
- Session already has all the infrastructure (events, messages, persistence)
- OpenCode uses the same mapping
- Simplifies result injection (just find session by ID)

### 3. Process-local registry (no persistence)

**Decision**: `Map<string, ActiveJob>` in memory, lost on restart

**Rationale**:
- Matches OpenCode's design (explicitly documented as non-durable)
- Simpler implementation
- Background tasks are typically short-lived (minutes)
- Persistence can be added later if needed

### 4. Synthetic message injection for results

**Decision**: Inject a `synthetic: true` message into parent session on completion

**Rationale**:
- Parent agent sees the result in its message stream
- Can trigger continued reasoning (agent sees new context)
- OpenCode uses the same pattern
- Distinct from steer() — synthetic messages are visible to user

### 5. Subagent depth limit = 1

**Decision**: Background subagents cannot spawn their own background subagents

**Rationale**:
- Prevents unbounded resource consumption
- Simplifies cancellation cascade
- OpenCode defaults to depth 1
- Can be relaxed later with depth tracking

## Component Changes

### BackgroundJobService (new: src/background/service.ts)

```typescript
export type JobStatus = "running" | "completed" | "error" | "cancelled";

export interface ActiveJob {
  id: string;                    // = child session ID
  type: "subagent" | "btw";     // who started this job
  title: string;                 // human-readable description
  status: JobStatus;
  startedAt: number;             // Date.now()
  completedAt: number | null;
  output: string | null;         // result text (on completion)
  error: string | null;          // error text (on error)
  metadata: Record<string, unknown>;
  unsub: () => void;             // event subscription handle
}

export class BackgroundJobService {
  private jobs: Map<string, ActiveJob>;

  start(opts: { id, type, title, run, onComplete }): ActiveJob;
  wait(id: string): Promise<ActiveJob>;
  cancel(id: string): ActiveJob | undefined;
  promote(id: string): ActiveJob | undefined;
  list(): ActiveJob[];
  get(id: string): ActiveJob | undefined;
  dispose(): void;              // cancel all on shutdown
}
```

### Subagent Tool Extension (src/tools/subagent.ts)

Add `background` parameter to schema:
```typescript
background: Type.Optional(Type.Boolean({
  description: "Run in background. You'll be notified on completion. Don't poll or sleep."
}))
```

When `background=true`:
- Create child session
- `backgroundJobSvc.start(...)` 
- Register completion callback
- Return immediately with `{ task_id, status: "running" }`

When `background=false` (default):
- Existing synchronous behavior unchanged

### TUI Changes (src/tui/App.tsx)

- New state: `backgroundJobs: ActiveJob[]` (synced from server via polling or event)
- `displayMessages`: append bg job cards for running/completed jobs
- Ctrl+B keybinding: `handlePromote()` — promote current foreground task
- Background job card rendering: reuse SubagentMessageView style

### /btw Rewrite (src/tui/commands.ts)

- `/btw` = promote current task + create side session (same view-switch pattern)
- Uses `backgroundJobSvc.promote()` instead of custom BtwBackgroundTask
- Simpler: no more BtwState/BtwBackgroundTask types
