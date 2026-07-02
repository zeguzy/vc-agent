## ADDED Requirements

### Requirement: Vim Cursor Navigation in Normal Mode

The TUI SHALL provide vim-style cursor navigation within the message area when the user is in NORMAL mode. A virtual cursor SHALL be rendered at the current position and SHALL move in response to vim motion commands.

#### Scenario: Basic cursor movement with h/j/k/l

- **WHEN** the user is in NORMAL mode and presses `h`
- **THEN** the virtual cursor SHALL move one cell to the left, stopping at the message area's left boundary
- **WHEN** the user presses `l`
- **THEN** the virtual cursor SHALL move one cell to the right, stopping at the last non-empty cell on the current line
- **WHEN** the user presses `j` and the cursor is not at the bottom of the visible viewport
- **THEN** the virtual cursor SHALL move one row down
- **WHEN** the user presses `j` and the cursor IS at the bottom of the visible viewport
- **THEN** the message area SHALL scroll down by one line to reveal the next row, and the cursor SHALL move to that row
- **WHEN** the user presses `k` and the cursor is not at the top of the visible viewport
- **THEN** the virtual cursor SHALL move one row up

#### Scenario: Word movement with w/b/e

- **WHEN** the user presses `w`
- **THEN** the cursor SHALL jump to the start of the next word (skipping whitespace and current word)
- **WHEN** the user presses `b`
- **THEN** the cursor SHALL jump to the start of the previous word
- **WHEN** the user presses `e`
- **THEN** the cursor SHALL jump to the end of the current word (or next word if already at end)

#### Scenario: Line navigation with 0/$/^

- **WHEN** the user presses `0`
- **THEN** the cursor SHALL move to the first cell of the current visual line
- **WHEN** the user presses `$`
- **THEN** the cursor SHALL move to the last non-empty cell of the current visual line
- **WHEN** the user presses `^`
- **THEN** the cursor SHALL move to the first non-blank cell of the current visual line

#### Scenario: Cursor clamping to non-empty cells

- **WHEN** the cursor is moved to a cell that is empty (whitespace or void)
- **THEN** the cursor SHALL be clamped to the nearest non-empty cell on that line
- **WHEN** the cursor is on a line that has no non-empty cells
- **THEN** the cursor SHALL remain at the first column of that line

#### Scenario: Cursor display

- **WHEN** the user is in NORMAL mode and the virtual cursor is active
- **THEN** the terminal cursor SHALL be visible at the cursor position via `renderer.setCursorPosition()`
- **AND** the cell at the cursor position SHALL be highlighted (inverted colors) to indicate cursor location

### Requirement: Character Find and Easymotion Jump

The TUI SHALL support vim-style character search (`f/F/t/T`) and easymotion-style screen-wide jump (`s`) in NORMAL mode.

#### Scenario: Find char with f/F

- **WHEN** the user presses `f` followed by a character `<char>`
- **THEN** the cursor SHALL jump to the next occurrence of `<char>` on the current line
- **WHEN** the user presses `F` followed by a character
- **THEN** the cursor SHALL jump to the previous occurrence of that character on the current line
- **WHEN** no match is found on the current line
- **THEN** the cursor SHALL remain in place

#### Scenario: Till char with t/T

- **WHEN** the user presses `t` followed by a character
- **THEN** the cursor SHALL jump to the cell immediately before the next occurrence of that character
- **WHEN** the user presses `T` followed by a character
- **THEN** the cursor SHALL jump to the cell immediately after the previous occurrence of that character

#### Scenario: Easymotion jump with s

- **WHEN** the user presses `s` followed by a character `<char>`
- **THEN** the TUI SHALL scan all visible cells in the message area for occurrences of `<char>`
- **AND** SHALL assign short labels to each match using the SCTree algorithm (sorted by Manhattan distance from cursor)
- **AND** SHALL render the labels on screen via buffer overlay
- **WHEN** the user then presses the label key(s) corresponding to a target
- **THEN** the cursor SHALL jump to that target position
- **WHEN** the user presses `Escape` during easymotion label selection
- **THEN** the easymotion overlay SHALL be cleared and the cursor SHALL remain at its original position
- **WHEN** no matches are found for the searched character
- **THEN** no labels SHALL be displayed and the cursor SHALL remain in place

### Requirement: Visual Selection and Yank

The TUI SHALL support vim-style visual mode for selecting text and yanking (copying) it to the clipboard.

#### Scenario: Enter visual mode

- **WHEN** the user is in NORMAL mode and presses `v`
- **THEN** the TUI SHALL enter VISUAL mode with the current cursor position as the selection anchor
- **AND** the status indicator SHALL reflect VISUAL mode

#### Scenario: Extend selection

- **WHEN** the user is in VISUAL mode and uses any motion command (h/j/k/l/w/b/e/f/etc.)
- **THEN** the selection SHALL extend from the anchor to the new cursor position
- **AND** all cells within the selection range SHALL be highlighted (inverted colors)

#### Scenario: Yank selection

- **WHEN** the user is in VISUAL mode and presses `y`
- **THEN** the selected text SHALL be extracted from the screen model and copied to the clipboard
- **AND** the TUI SHALL return to NORMAL mode
- **AND** the selection highlight SHALL be cleared
- **AND** a toast notification SHALL confirm the copy

#### Scenario: Exit visual mode

- **WHEN** the user is in VISUAL mode and presses `Escape`
- **THEN** the TUI SHALL return to NORMAL mode and clear the selection

## MODIFIED Requirements

### Requirement: Normal Mode Keymap

The NORMAL mode keymap is extended to include vim cursor navigation commands. The `j` and `k` keys change from viewport scrolling to cursor movement with auto-scroll.

#### Scenario: j/k cursor movement (CHANGED from scroll-by-2)

- **WHEN** the user is in NORMAL mode and presses `j`
- **THEN** the virtual cursor SHALL move one row down (instead of scrolling by 2 lines)
- **AND** if the cursor reaches the bottom of the visible viewport, the message area SHALL auto-scroll to keep the cursor visible
- **WHEN** the user presses `k`
- **THEN** the virtual cursor SHALL move one row up
- **AND** if the cursor reaches the top of the visible viewport, the message area SHALL auto-scroll to keep the cursor visible

#### Scenario: New motion bindings in NORMAL mode

- **WHEN** the user is in NORMAL mode
- **THEN** the following keys SHALL be active: `h` (cursor left), `l` (cursor right), `w` (word forward), `b` (word back), `e` (word end), `0` (line start), `$` (line end), `^` (first non-blank), `v` (visual mode), `s` (easymotion), `f/F/t/T` (char find/till)
- **AND** the following keys remain unchanged: `i/a/o` (to INSERT), `g/G` (scroll top/bottom), `t` is repurposed as till-char (was toggle thinking — moved to a different key)
