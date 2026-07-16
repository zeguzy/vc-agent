## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      AgentServer                         │
│                                                          │
│  ┌──────────┐     ┌──────────────────┐                  │
│  │ session  │     │ btwBackgroundTask│ ← new             │
│  │ (main)   │     │  .bgSession      │                   │
│  │          │     │  .bgUnsub        │                   │
│  │          │     │  .status         │                   │
│  └────┬─────┘     └────────┬─────────┘                  │
│       │                    │                              │
│       │  injectNotification│  subscribe events            │
│       │◄───────────────────┤                              │
│       │                    │                              │
│  ┌────┴────────────────────┴──────────────────┐          │
│  │              TUI (App.tsx)                  │          │
│  │                                             │          │
│  │  btwBackgroundTask: BtwBgTask | null        │          │
│  │                                             │          │
│  │  displayMessages:                           │          │
│  │    if btwBackgroundTask → bg session msgs   │          │
│  │    elif activeMemberName → member msgs      │          │
│  │    else → main session msgs                 │          │
│  │                                             │          │
│  │  handlePrompt:                              │          │
│  │    if btwBackgroundTask → bgSession.prompt  │          │
│  │    elif activeMemberName → directMember     │          │
│  │    else → normal prompt                     │          │
│  └─────────────────────────────────────────────┘          │
└─────────────────────────────────────────────────────────┘
```

## Data Flow

### /btw Enter Flow

```
User types /btw
    │
    ▼
Command handler calls client.btwEnter()
    │
    ▼
Server: handleBtwEnter()
    ├── 1. Capture current session as bgSession reference
    ├── 2. Create NEW empty AgentSession (not fork!)
    │       - Same model, same tools, same cwd
    │       - System prompt includes awareness note:
    │         "You are in a side conversation. Background task is running: <summary>"
    ├── 3. Subscribe to bgSession events via createBackgroundMonitor
    │       - agent_end → injectNotification(newSession, completionNote)
    ├── 4. Store BtwBackgroundTask state
    ├── 5. Return { backgroundSessionId, newSessionId }
    │
    ▼
TUI: setBtwBackgroundTask(task)
    ├── displayMessages switches to newSession.messages
    ├── TeamTopology shows bg task row
    └── Input routes to newSession.prompt()
```

### /btw Back Flow

```
User types /btw back
    │
    ▼
Command handler calls client.btwBack()
    │
    ▼
Server: handleBtwBack()
    ├── 1. Dispose sideSession (resource cleanup — abort AgentSession + SessionManager)
    ├── 2. DO NOT unsub bgUnsub — monitor persists until bg task completes
    ├── 3. Clear btwBackgroundTask.sideSession (set to null)
    │   NOTE: btwBackgroundTask itself stays alive (bgSession still running)
    │   Monitor continues injecting notifications into mainSession on completion
    │
    ▼
TUI: setBtwBackgroundTask(null) — view switches back to main
    ├── displayMessages switches back to main session
    ├── Input routes to normal prompt
    └── TeamTopology STILL shows bg task row (status tracking continues)
```

### Background Task Completion Flow

```
bgSession agent_end event
    │
    ▼
createBackgroundMonitor callback (ALWAYS fires, even after /btw back)
    ├── Extract last assistant message as summary
    ├── injectNotification(this.session [mainSession], completionNote)
    │       - If main session streaming → steer (mid-turn)
    │       - If main session idle → silent (user sees on next interaction)
    ├── Update btwBackgroundTask.status = "done"
    ├── Unsubscribe bgUnsub (monitoring complete)
    └── TUI: TeamTopology updates bg task row (✓ icon)
            After a delay, clear btwBackgroundTask entirely
```

### Race Condition Guard

Before creating the background monitor, check if the bg task already completed:

```
handleBtwEnter():
    ...
    if (!bgSession.isStreaming) {
        // Task already done — no need for monitor
        // Inject completion note immediately into sideSession
        // Set status = "done" directly
    } else {
        bgUnsub = createBackgroundMonitor(bgSession, ...)
    }
```

## Key Design Decisions

### 1. View Switch vs Session Switch

**Decision**: View switch (like `activeMemberName` pattern)

**Rationale**: 
- Session switch is heavyweight: triggers `setRebindSession`, team disposal concerns, `preserveBackground` hack
- View switch is lightweight: just change which session's messages are displayed
- Member navigation already proves this pattern works at scale
- No need for `preserveBackground` — main session never changes

### 2. New Empty Session vs Forked Session

**Decision**: New empty session with awareness context

**Rationale**:
- User explicitly wants "clean" side conversation, not history dump
- Fork copies all messages → visual clutter, confusing UX
- Empty session + system prompt awareness note gives context without noise
- If user needs history context, they can ask the agent directly

### 3. Independent AgentSession vs TeamManager.createMember

**Decision**: Independent AgentSession (simpler)

**Rationale**:
- Background task doesn't need team file system (TEAM.md, member dirs)
- Doesn't need memory/message tools
- Doesn't need task assignment system
- Just needs: same model + tools + cwd + awareness prompt
- Creating via `createAgentSession()` directly is simpler and avoids team side effects

### 4. Background Task Visibility

**Decision**: Show in TeamTopology area as a special row

**Rationale**:
- TeamTopology already renders member status rows with spinner/icons
- Adding a "bg-task" row is natural extension
- User can see at a glance that a background task is running
- Consistent with existing visual language

## Component Changes

### BtwBackgroundTask Type (replaces BtwState)

```typescript
interface BtwBackgroundTask {
  /** The background (original) session — keeps running independently. */
  bgSession: AgentSession;
  /** Subscription to background session events. */
  bgUnsub: () => void;
  /** The new side-conversation session. */
  sideSession: AgentSession;
  /** Current status of the background task. */
  status: "active" | "done" | "error";
  /** Human-readable summary of what the background task was doing. */
  taskSummary: string;
}
```

### Server API Changes

- `handleBtwEnter()` → creates new empty session, returns `{ backgroundSessionId, sideSessionId }`
- `handleBtwBack()` → disposes sideSession, clears sideSession ref, keeps monitor alive
- `handleBtwStatus()` → returns `{ active, status, taskSummary, backgroundSessionId }`
- `getBtwSideSession()` → NEW: returns sideSession AgentSession for TUI direct subscription (InProcessClient only; HttpClient throws NotSupportedError)
- Remove `preserveBackground` flag entirely

### TUI State Changes

- New state: `btwBackgroundTask: BtwBackgroundTaskInfo | null`
- `displayMessages` gains third branch: `btwBackgroundTask` → side session messages
- `handlePrompt` gains third branch: `btwBackgroundTask` → `sideSession.prompt()`
- TeamTopology: append bg-task row after member rows
- Keyboard: `Ctrl+B` or `/btw back` to return from side conversation

### Client API Changes

- `btwEnter()` → returns `{ backgroundSessionId, sideSessionId }`
- `btwBack()` → unchanged signature
- `btwStatus()` → returns extended info with status
- `getBtwSideSession()` → NEW: returns AgentSession for TUI direct subscription (InProcessClient only)
- `btwSidePrompt(text)` → NEW: sends prompt to side session (InProcessClient delegates to server; HttpClient throws NotSupportedError)

### TUI→SideSession Streaming

The TUI accesses sideSession the same way it accesses member sessions:
- `client.getBtwSideSession()` returns the `AgentSession` object
- TUI subscribes via `sideSession.subscribe()` with 120ms throttle (same as member pattern in App.tsx:161-223)
- TUI reads `sideSession.messages` via `mapSdkMessagesToTui()`
- This only works for InProcessClient (TUI mode). HttpClient/remote mode is not supported for /btw.

### /btw + Team Member Interaction

When `/btw` is entered while viewing a team member (`activeMemberName` is set):
- Clear `activeMemberName` first (set to null)
- Then set `btwBackgroundTask`
- This prevents dual view-state confusion
- displayMessages priority: btw > member > main
