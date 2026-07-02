## Tasks

- [ ] 1. Create screen model module (`src/tui/vim/screenModel.ts`)
  - Define `ScreenCell` type: `{ char: string; isEmpty: boolean }`
  - Implement `scanBuffer(buffer: OptimizedBuffer, bounds: Bounds): ScreenCell[][]`
    - Read `buffer.buffers.char` Uint32Array within bounds rectangle
    - Decode char codes to strings (handle Unicode width-2 chars via `buffer.widthMethod`)
    - Mark cells with char code 0 or space (0x20) as `isEmpty`
  - Implement `extractText(model, range: {start, end}): string`
  - Write unit tests (`tests/vim/screenModel.test.ts`)

- [ ] 2. Create virtual cursor module (`src/tui/vim/cursor.ts`)
  - Implement `VirtualCursor` class: `{ row, col }` + methods
    - `moveTo(row, col)`, `moveLeft()`, `moveRight()`, `moveUp()`, `moveDown()`
    - `clampToScreenModel(model)` — snap to nearest non-empty cell
    - `isAtBounds(model)` — check if at visible edge
  - Write unit tests (`tests/vim/cursor.test.ts`)

- [ ] 3. Create vim motions module (`src/tui/vim/motions.ts`)
  - `charLeft(model, cursor)`, `charRight(model, cursor)`
  - `charUp(model, cursor)`, `charDown(model, cursor)` — return scroll delta if at edge
  - `wordForward(model, cursor)`, `wordBackward(model, cursor)`, `wordEnd(model, cursor)`
    - Word = run of alphanumeric/underscore; skip whitespace runs
  - `lineStart(cursor)`, `lineEnd(model, cursor)`, `firstNonBlank(model, cursor)`
  - `findChar(model, cursor, char, opts: {till?: boolean; backward?: boolean})`
  - Write unit tests (`tests/vim/motions.test.ts`)

- [ ] 4. Create easymotion module (`src/tui/vim/easymotion.ts`)
  - `findTargets(model, char: string): Position[]` — scan all cells for char
  - `assignLabels(targets: Position[], cursor: Position): Map<string, Position>`
    - Implement SCTree: sort by Manhattan distance, assign single→double keys
    - Keyset: `"fjrudkeislwoaqghtypvncmxzb"`
  - `resolveLabel(typed: string, labels: Map<string, Position>): { done: boolean; pos?: Position }`
    - Return done=true when label fully typed
  - Write unit tests (`tests/vim/easymotion.test.ts`)

- [ ] 5. Create vim state machine (`src/tui/vim/vimState.ts`)
  - Define `VimState` type: `{ mode, cursor, pending, easymotion, visualAnchor }`
  - Implement `handleKey(key: string, state: VimState, model: ScreenCell[][]): HandleResult`
    - HandleResult = `{ state: VimState; scrollDelta?: number; yankText?: string }`
    - States: idle → motion → pendingChar (for f/F/t/T) → pendingLabel (for easymotion)
    - Visual mode: `v` toggles, movements extend, `y` yanks → back to normal
  - Write unit tests (`tests/vim/vimState.test.ts`)

- [ ] 6. Create overlay renderer (`src/tui/vim/overlay.ts`)
  - `renderCursor(buffer, cursor)` — invert cell colors at cursor position via `setCell()`
  - `renderLabels(buffer, labels)` — draw easymotion labels (highlighted) via `setCell()`
  - `renderSelection(buffer, range)` — invert colors for cells in selection range
  - `renderAll(buffer, vimState, model)` — top-level dispatch
  - No unit tests needed (visual output, tested manually)

- [ ] 7. Create public API + integration glue (`src/tui/vim/index.ts`)
  - `createVimOverlay(renderer, scrollRef): { postProcess: Function; handleKey: Function; cleanup: Function }`
  - Manage `addPostProcessFn` registration/unregistration based on mode
  - Expose `handleKey` for App.tsx to call
  - Export `VimState` type

- [ ] 8. Integrate into App.tsx
  - Import `createVimOverlay` and initialize with `renderer` + `scrollRef`
  - Register/unregister postProcessFn when entering/leaving NORMAL mode
  - Wire keyboard: route vim actions to `vimOverlay.handleKey()`
  - Wire scrollDelta results to `scrollRef.current.scrollBy()`
  - Wire yankText results to `copyToClipboard()`
  - Handle message bounds: query `scrollRef.current` absolute position

- [ ] 9. Extend keymap.ts
  - Add NORMAL mode bindings: `h`→vimLeft, `l`→vimRight, `w`→vimWordFwd, `b`→vimWordBack, `e`→vimWordEnd, `v`→vimVisual, `0`→vimLineStart, `$`→vimLineEnd, `^`→vimFirstNonBlank, `s`→vimEasymotion, `f`→vimFindChar, `F`→vimFindCharBack, `t`→vimTillChar, `T`→vimTillCharBack
  - Keep existing: `j/k` (reassigned to vim cursor up/down), `g/G` (scroll top/bottom), `i/a/o` (to insert)
  - Update `/help` command output with new bindings

- [ ] 10. Write spec delta (`specs/tui-messages/spec.md`)
  - Add requirement: "Vim Navigation in Normal Mode"
  - Add requirement: "Easymotion Jump"
  - Add requirement: "Visual Selection and Yank"
  - Scenarios for each requirement

- [ ] 11. Full check pass
  - Run `bun run check` — fix typecheck/lint/test failures
  - Manual TUI test: launch `bun run dev`, verify all motions work
