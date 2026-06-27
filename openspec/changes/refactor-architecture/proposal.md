## Why

The codebase has accumulated architectural technical debt during rapid MVP iteration: App.tsx is a 482-line god component, `agent/session.ts` mixes 4 unrelated responsibilities, settings are fragmented across 7 single-purpose files, naming is misleading (`store.ts` contains no state management), and error handling is inconsistent (silent swallows, verbose inline patterns). These issues compound with each new feature, increasing cognitive load and slowing development.

## What Changes

1. **Extract custom hooks from App.tsx** — `useSessionEvents`, `useStreamingBuffer`, `useSessionPicker` move to `tui/hooks/`, reducing App.tsx from 482 to ~180 lines
2. **Unify message mapping** — subscribe callback delegates to shared mapping functions instead of manually constructing Message objects
3. **Split `agent/session.ts`** — content extraction utilities move to `utils/content.ts`, error formatting to `utils/formatError.ts`
4. **Merge `settings/` files** — 7 single-setting files (each ~30 lines) merge into `settings/definitions.ts`
5. **Clean up `config.ts`** — remove redundant `loadConfig` alias and unused `defaultConfig`
6. **Rename `store.ts` → `message.ts`** — reflects actual purpose (message model + factories, not state management)
7. **Restructure `tui/` directory** — grouped into `hooks/`, `utils/`, `components/` subdirectories
8. **Standardize error formatting** — `formatError(err)` utility replaces 15+ instances of `err instanceof Error ? err.message : String(err)`; eliminate silent `.catch(() => {})` patterns

## Capabilities

### New Capabilities

None — this is a pure internal refactoring. No user-visible behavior changes.

### Modified Capabilities

- **agent-session**: File split changes import paths for `extractAssistantContent` / `extractAssistantText` / `summarizeArgs` (moved to `utils/content.ts`). No behavioral change.
- **tui-messages**: New hook files (`tui/hooks/`) and `tui/utils/` subdirectory. Import paths change for theme, syntax, clipboard, selection, streaming. No behavioral change.
- **tui-layout**: `store.ts` renamed to `message.ts` — import paths updated across components. No behavioral change.

## Impact

- **Affected files**: ~30 source files (import path updates, file moves, extract/merge operations)
- **New files**: `utils/content.ts`, `utils/formatError.ts`, `tui/hooks/useSessionEvents.ts`, `tui/hooks/useStreamingBuffer.ts`, `tui/hooks/useSessionPicker.ts`
- **Deleted files**: `settings/compaction-enabled.ts`, `settings/context-mode.ts`, `settings/thinking-collapsed.ts`, `settings/thinking-level.ts`, `settings/model.ts`
- **Renamed**: `store.ts` → `message.ts`
- **Tests**: Updated import paths; new tests for extracted hooks and `formatError` utility
- **No breaking changes**: All external API surfaces (CLI flags, config format, Pi SDK integration) remain unchanged

## Non-goals

- **No behavior changes** — functionality is strictly preserved; only file organization and naming change
- **No React Context for commandRegistry** — global singleton remains (low ROI for CLI tool)
- **No LspClient sleep fix** — event-driven LSP notification handling deferred to future LSP enhancement
- **No new features** — period
