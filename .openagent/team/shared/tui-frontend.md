# TUI Frontend Architecture (2026-07-06)

## Component Tree & State

### App.tsx — Root Component
**States** (20+, all managed via `useState`):
- `messages: Message[]` — main message list (init from `client.getMappedMessages()`)
- `isRunning: boolean` — agent running flag
- `mode: Mode` — `"insert"` / `"normal"` (vim mode)
- `agentMode: AgentMode` — `"standard"` / `"team"` / `"planner"` / `"orchestrator"`
- `thinkingCollapsed: boolean` — collapse thinking blocks
- `activeMemberName: string|null` — `null`=leader view; string=viewing member sub-session
- `memberTick: number` — triggers re-render for member streaming
- `members: MemberState[]` — team member list (from `client.listMembers()`)
- `contextUsage: {tokens, window, percent}`
- `configState: Config` — runtime config copy
- `showSettings/showWorkers: boolean`
- `pendingQuestion: QuestionData|null`
- `pendingEditConfirm: boolean`
- `pendingInput: {text, nonce}|null` — for `/undo` input restoration

**Closure Trap Pattern**: ALL async callbacks (`useKeyboard`, `useCallback`, `useEffect`) read latest values via `xxxRef.current`, not state directly. Each state has a corresponding ref synced with `ref.current = value;`. This is the React 18 pattern — `useKeyboard` callback created once at mount.

```
Layout (top → bottom):
  Toast (absolute, top-right)
  MessageList / WelcomeBanner (flexGrow scrollbox)
  [Queued messages box] (conditional)
  [SettingsPanel] (overlay, conditional)
  [SessionPicker] (overlay, conditional)
  [WorkersView] (overlay, conditional)
  InputBox container:
    [DiffConfirmBox / QuestionBox / InputBox]
    StatusBar
```

**handlePrompt routing**:
1. `activeMemberName` set → `client.directMember()`
2. Text starts with `/`:
   - `/skill:*` → `client.prompt()`
   - Other → `client.executeCommand()` via CommandRegistry
3. `isRunning` → `client.followUp()` (queues)
4. Otherwise → `client.prompt()` (new turn)

**useKeyboard dispatch** (single handler, mount-once):
1. Ctrl/Cmd+C → `copySelection()` if selection exists
2. `pendingQuestion` → only handle ctrlC
3. Escape+selection → clear selection
4. Normal mode + no modifier → `vimOverlay.handleKey()`
5. `resolveKey(mode, key)` → action switch
6. If `showSettings/showWorkers/showSessionPicker` → only ctrlC

**Member sub-session streaming**:
- `useEffect` on `activeMemberName`: subscribes to `member.session.subscribe()`
- Throttles updates at 120ms; flushes immediately on `agent_end`/`message_end`
- Uses `activeMemberMsgMapRef` + `memberTick` to drive re-render
- `useMemo` derives `displayMessages` from member messages when viewing

### MessageList
- `groupMessages()`: consecutive `read` tools → merged `ReadGroupView`
- Views: `UserMessageView`, `AssistantMessageView`, `ToolMessageView`, `ReadGroupView`, `TodoMessageView`, `WorkerMessageView`, `WorkerSummaryView`, `SeparatorView`
- All views `memo`-wrapped
- Thinking: collapsible, spinner animation (80ms frames) while streaming
- Tool results: truncated to 15 lines; edit patches → `<EditDiffView>`
- Codex-style: top-border panels, `backgroundInset` colors

### InputBox
- Slash-command autocomplete (`matchSuggestions`: commands + skills)
- History navigation: ↑/↓ through `sentMessages[]`, `savedDraft` restores original text
- `isHistoryNavRef` prevents `historyIndex` reset during nav
- `<MemberCard>` shown above input when `activeMemberName` set
- Info line: `[mode] · model · path · [branch]` (git dirty=warning color)

### StatusBar
- Left: `-- INSERT/NORMAL --` with mode color
- Team mode: member list with status icons + active highlight
- Right: context tokens ("12.5K (85%)") or "Copied to clipboard" (2s fade)

### DiffConfirmBox
- Two-phase: choose (←/→ accept/reject) → reject-feedback (textarea)
- Split/unified diff view based on terminal width
- `pathToFiletype()` for syntax highlighting

### QuestionBox
- Multi-step questions, single/multi-select, custom input
- Space toggles in multi-select; Enter confirms

### SettingsPanel
- j/k navigate; supports toggle/select/selectDynamic/input/modelPicker editors
- Writes config immediately on change

### SessionPicker
- Real-time search filtering; Ctrl+R rename; max 20 visible
- Current session marked with ●

---

## Keymap
```
INSERT mode:
  Escape → NORMAL
  Ctrl+C → abort / double to exit

NORMAL mode:
  i/a/o → INSERT    h/l → cursor left/right
  j/k → scroll down/up    g/G → scroll to top/bottom
  H → toggle thinking    Tab → cycle agent mode
  [ ] → prev/next member sub-session
```

---

## Hooks

### useSessionEvents
Subscribes to `client.subscribe()`, dispatches agent events to setMessages:
- `agent_start`: setIsRunning(true), un-mark queued
- `message_start`: create assistant message (extracts thinking via `extractAssistantContent`)
- `message_update`: `streaming.setPending()` + `scheduleUpdate()` (throttled)
- `message_end`: `streaming.flush()` (immediate)
- `tool_execution_start`: create tool msg, map `toolCallId→msgId` in ref; detect question tool
- `tool_execution_end`: update `toolStatus`/`toolResult`
- `compaction_start/end`: status messages
- `agent_end`: setIsRunning(false), add separator

Also subscribes to `client.subscribeTeam()` for worker events:
- `member_done`/`member_error`: update/create worker messages

### useStreamingBuffer
Throttled buffer: `scheduleUpdate` at 80ms, `flush` immediate on `message_end`.
Updates last assistant message in-place by scanning from end of array.

### useToasts
`pushToast(payload)` sets toast + auto-clears after `durationMs`.

### useSessionPicker
Manages picker state + `handlePickerSelect` (switchSession) + `handlePickerRename`.

### useTerminalWidth
Listens to `process.stdout.on("resize")` for responsive diff view.

---

## Vim Mode (`src/tui/vim/`)

**Architecture**: 3-layer
1. `vimState.ts` — `handleKey(key, state, model)` pure state machine
2. `overlay.ts` — `renderAll(buffer, state, model, bounds)` draws cursor/visual/easymotion
3. `index.ts` — `createVimOverlay()` bridges renderer ↔ state machine via `postProcess`

**State** (`VimState`): `mode` (normal/visual), `cursor`, `pending` (findChar/tillChar/easymotion/gotoLine/yank), `easymotion`, `visualAnchor`, `countStr`

**Operations**:
- hjkl: char-level movement (handles isContinuation)
- w/b/e: word movement (word/blank/punct classification)
- 0/^/\$: line start/first non-blank/end
- f/F/t/T{char}: find char (supports count, till)
- s{char}: EasyMotion (label-based jump)
- gg/G: document top/bottom (triggers `scrollEdge` for absolute scroll)
- {count}gg/G: go to line N
- v: visual mode toggle
- y{motion}/yy/Y: yank (copy to clipboard via OSC 52 + platform command)
- Escape: exit visual mode

**EasyMotion**: assigns labels from `fjrudkeislwoaqghtyp` keyset, sorted by distance, 3-tier labeling.

**screenModel.ts**: `scanBuffer()` extracts `ScreenCell[][]` from `OptimizedBuffer` (handles UTF-8, continuation cells). `extractText()` recovers text for yank.

**cursor.ts**: `clampToNonEmpty()` keeps cursor on valid content cells.

---

## Commands (21 built-in)

| Command | Handler |
|---------|---------|
| `/clear` | Clear messages |
| `/compact` | Context compaction |
| `/dcp` | DCP status/toggle |
| `/dcp-compress` | Manual DCP compress |
| `/model` | Cycle model |
| `/todos` | Show TODO list |
| `/plan` | Cycle agent mode |
| `/orchestrate` | Switch to orchestrator |
| `/exit` | `process.exit(0)` |
| `/setting` | Open settings panel |
| `/help` | Show help text |
| `/sessions` | Open session picker |
| `/new` | New session |
| `/name` | Name session |
| `/skills` | List skills |
| `/load-skill` | Load dynamic skill |
| `/unload-skill` | Unload skill |
| `/undo` | Undo last turn (tree navigate) |
| `/team` | Team management (list/remove/pause/resume/cancel) |
| `/workers` | Open workers panel |

**CommandRegistry** (`src/commands/registry.ts`): global singleton, `register()`, `match()` (prefix), `execute()`.

---

## Theme (`theme.ts`)
Codex-style dark palette:
- Backgrounds: `#000000` → `#141416` → `#1C1C1E` → `#2C2C2E`
- Text: `#EDEDED` → `#878787` → `#626A76`
- Semantic: primary=`#0A84FF`, secondary=`#64D2FF`, accent=`#BF5AF2`
- Status: error=`#FF453A`, warning=`#FFD60A`, success=`#30D158`
- New (commit 30089d9): `borderDim=#1E222A`, `backgroundBar=#101214`

`syntax.ts` exports `syntaxStyle` (SyntaxStyle singleton) with ~160 scope rules covering:
code, markdown, extmark, diff, LSP scopes.

---

## Utils
- **clipboard.ts**: Dual strategy — OSC 52 escape seq (SSH/tmux) + platform cmd (osascript/wl-copy/xclip)
- **selection.ts**: `copySelection()` — get selected text → clipboard + clear selection
- **streaming.ts**: `splitStreamingText()` — separates settled head from unclosed code block tail
- **history.ts**: Persists to `~/.config/openagent/history`, dedup consecutive, max 1000 entries
- **filetype.ts**: Extension → tree-sitter language (40+ langs)
- **git.ts**: Branch from `.git/HEAD`, dirty from `git status --porcelain`

---

## Key Commits (recent UI changes)

| Commit | Description |
|--------|-------------|
| `eb4b5fc` | Member tags row + sub-session switching with real-time streaming; `[`/`]` keybindings |
| `30089d9` | Theme colors: `borderDim`, `backgroundBar` |
| `783620e` | Codex-style InputBox/StatusBar: top-border + backgroundInset; MemberCard component |
| `70d0536` | Codex-style message panels: UserMessageView/ToolMessageView top-border layout |
| `53585b8` | Wire members/tasks props to InputBox/StatusBar |

**Uncommitted diff** (`App.tsx`): Adds `setMembers(client.listMembers())` + `setActiveMemberName(null)` in `onSessionChange` handler to reset member view on session switch.

---

## Data Flow

```
client.subscribe() → useSessionEvents → setMessages / streaming / toolCallIdToMsgId
client.subscribeTeam() → setMembers + worker event handling
client.onSessionChange() → reset all state + reload messages

Events:
  message_update → StreamingBuffer.scheduleUpdate (80ms throttle)
  message_end → StreamingBuffer.flush (immediate)
  tool_execution_start/end → toolCallIdToMsgId map + message updates
  agent_start/end → isRunning toggle

Keyboard:
  normal mode → vimOverlay.handleKey() → vimState.handleKey() → motions/cursor
  insert mode → resolveKey() → action dispatch
  ctrlC → copySelection / abort / exit

Input:
  /command → client.executeCommand() → CommandRegistry
  /skill:* → client.prompt()
  isRunning → client.followUp()
  default → client.prompt()
  activeMember → client.directMember()
```
