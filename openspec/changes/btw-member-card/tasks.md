## Tasks

### Phase 1: Core Types & Server

- [ ] **T1**: Rewrite `src/session/btw.ts` — replace `BtwState` with `BtwBackgroundTask` type, update `createBackgroundMonitor` to inject into main session (not bg session), add `createSideSession()` helper that creates an empty AgentSession with awareness prompt
- [ ] **T2**: Rewrite `handleBtwEnter()` in `src/server/index.ts` — create new empty session instead of fork, store `BtwBackgroundTask`, remove `preserveBackground` flag and all references
- [ ] **T3**: Simplify `handleBtwBack()` — just unsubscribe monitor + clear state, no `switchSession` call
- [ ] **T4**: Extend `handleBtwStatus()` — return `status` and `taskSummary` fields
- [ ] **T5**: Add `handleBtwSideMessages()` — returns side session messages for TUI display

### Phase 2: Client API

- [ ] **T6**: Update `BtwEnterResult` type in `src/client/types.ts` — add `sideSessionId` field
- [ ] **T7**: Update `BtwStatusResult` type — add `status` and `taskSummary` fields
- [ ] **T8**: Add `getBtwSideMessages()` to `AgentClient` interface + InProcessClient + HttpClient implementations
- [ ] **T9**: Add HTTP routes in `src/server/http.ts` — `GET /btw/side-messages`

### Phase 3: TUI State & Rendering

- [ ] **T10**: Add `btwBackgroundTask` state to `src/tui/App.tsx` — `useState<BtwBgTaskInfo | null>(null)`, ref pattern
- [ ] **T11**: Extend `displayMessages` — third branch: when `btwBackgroundTask` is set, show side session messages (subscribe to side session events like member subscription pattern)
- [ ] **T12**: Extend `handlePrompt` — third branch: when `btwBackgroundTask` is set, route input to side session via `client.btwSidePrompt(text)`
- [ ] **T13**: Add `handleBtwNav()` — keyboard shortcut to toggle between main view and side conversation view

### Phase 4: Background Task Card UI

- [ ] **T14**: Extend `TeamTopology` component — add bg-task row after member rows, with spinner (active) / ✓ (done) / ✗ (error) icon, task summary text
- [ ] **T15**: Add `btwBackgroundTask` prop to TeamTopology, render conditionally

### Phase 5: Command Handler

- [ ] **T16**: Rewrite `/btw` command in `src/tui/commands.ts` — call `btwEnter()`, set TUI state instead of appending separator messages
- [ ] **T17**: Rewrite `/btw back` command — call `btwBack()`, clear TUI state

### Phase 6: Cleanup & Verification

- [ ] **T18**: Remove `preserveBackground` flag and all references in `src/server/index.ts`
- [ ] **T19**: Remove `createBranchedSession` usage from btw flow
- [ ] **T20**: Run `bun run check` — typecheck + lint + test must pass
