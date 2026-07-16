## Tasks

### Phase 1: BackgroundJobService Core

- [ ] **T1**: Create `src/background/types.ts` — `JobStatus`, `ActiveJob`, `JobType`, `StartJobOpts`, `JobCompletionResult` types
- [ ] **T2**: Create `src/background/service.ts` — `BackgroundJobService` class with `Map<string, ActiveJob>` registry, `start()`, `wait()`, `cancel()`, `promote()`, `list()`, `get()`, `dispose()` methods. `start()` forks `run()` via `queueMicrotask`, stores unsub handle, returns ActiveJob. `wait()` returns a Promise that resolves when job status leaves "running". `cancel()` sets status + calls unsub. `dispose()` cancels all jobs.
- [ ] **T3**: Add unit tests `tests/background-service-unit.test.ts` — test start→complete, start→cancel, start→error, list, get, dispose

### Phase 2: Integrate with AgentServer

- [ ] **T4**: Add `BackgroundJobService` instance to `AgentServer` constructor in `src/server/index.ts`. Initialize in constructor, dispose in process exit handlers.
- [ ] **T5**: Add `handleListBackgroundJobs()`, `handleGetBackgroundJob(id)`, `handleCancelBackgroundJob(id)`, `handlePromoteBackgroundJob(id)` methods to AgentServer — delegate to service
- [ ] **T6**: Add `backgroundJobSvc` to client interface `src/client/types.ts` — `listBackgroundJobs()`, `getBackgroundJob(id)`, `cancelBackgroundJob(id)`, `promoteBackgroundJob(id)` methods
- [ ] **T7**: Implement client methods in `src/client/in-process.ts` (delegate to server) and `src/client/http.ts` (HTTP routes)
- [ ] **T8**: Add HTTP routes in `src/server/http.ts` — `GET /background/jobs`, `GET /background/jobs/:id`, `DELETE /background/jobs/:id`, `POST /background/jobs/:id/promote`

### Phase 3: Extend Subagent Tool

- [ ] **T9**: Add `background` parameter to subagent tool schema in `src/tools/subagent.ts` — `Type.Optional(Type.Boolean())`
- [ ] **T10**: Implement background execution path in subagent tool — when `background=true`: create child session, call `backgroundJobSvc.start()`, register completion callback that injects result into parent session, return immediately with task_id
- [ ] **T11**: Implement result injection — `injectBackgroundResult(parentSession, job)` — when parent streaming: `steer()`, when idle: inject synthetic assistant message via `session.prompt()` with synthetic marker
- [ ] **T12**: Add `"background"` to subagent tool's allowed tool names if needed, ensure tool whitelist includes it

### Phase 4: TUI Background Job Cards

- [ ] **T13**: Add `backgroundJobs` state to `src/tui/App.tsx` — `useState<ActiveJob[]>([])`, sync via polling (2s interval calling `client.listBackgroundJobs()`)
- [ ] **T14**: Extend `displayMessages` — append background job cards for running/completed jobs. Each card is a synthetic message showing: status icon + title + output preview
- [ ] **T15**: Add Ctrl+B keybinding in keymap — `handlePromote()` that promotes current foreground subagent to background
- [ ] **T16**: Update `SubagentMessageView.tsx` — support rendering background job status (running spinner, completed ✓, error ✗)

### Phase 5: Rewrite /btw on BackgroundJobService

- [ ] **T17**: Rewrite `/btw` command handler in `src/tui/commands.ts` — use `backgroundJobSvc.promote()` to move current task to background, then create side session (same view-switch pattern)
- [ ] **T18**: Simplify `src/session/btw.ts` — remove `BtwBackgroundTask` type and `createBackgroundMonitor`, replace with BackgroundJobService-based tracking
- [ ] **T19**: Update `src/server/index.ts` btw handlers — `handleBtwEnter` uses promote + side session, `handleBtwBack` uses cancel or just view-switch

### Phase 6: Cleanup & Verification

- [ ] **T20**: Remove `preserveBackground` flag if any remnants remain
- [ ] **T21**: Remove `BtwBackgroundTask` type from `src/session/btw.ts` and `src/client/types.ts` if fully replaced
- [ ] **T22**: Run `bun run check` — typecheck + lint + test must pass
- [ ] **T23**: Run `bun test tests/background-service-unit.test.ts` — new unit tests must pass
