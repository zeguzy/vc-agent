## 1. Keymap — add member navigation shortcuts

- [x] 1.1 Add `prevMember` (`[`) and `nextMember` (`]`) bindings to `src/tui/keymap.ts` keymap array, mode "normal", with appropriate `desc` strings
- [x] 1.2 Verify new actions are resolvable via `resolveKey("normal", { name: "[", ... })` and `resolveKey("normal", { name: "]", ... })`

## 2. MemberTags — new component

- [x] 2.1 Create `src/tui/components/MemberTags.tsx` exporting a React component that renders a single-row tag line from `members: MemberState[]` and `activeMemberName: string | null` props
- [x] 2.2 Tag format: `▶ leader (○) · sasha (◌) · kim (✓)` — leader item first, then members in list order, separated by ` · `, each tag showing `name (status_icon)`
- [x] 2.3 Active member highlights with `▶` prefix + `colors.primary` color; leader active when `activeMemberName` is null
- [x] 2.4 Status icons reuse the same mapping as `WorkersView.statusIcon()` (◌ active, ○ idle, ✓ done, ✗ error, ⏸ paused, ⊘ cancelled)
- [x] 2.5 Single row layout: `height={1}`, `paddingLeft={1}`, `paddingRight={1}`, no wrapping
- [x] 2.6 Subscribe to `client.subscribeTeam` and refresh member list on team events
- [x] 2.7 Return null/hide when `members.length === 0`

## 3. InputBox — accept member data and render tags

- [x] 3.1 Add `members?: MemberState[]` and `activeMemberName?: string | null` to `InputBoxProps`
- [x] 3.2 Render `<MemberTags members={members} activeMemberName={activeMemberName} client={...} />` below the textarea border box and above (or as last child of) InputBox return
- [x] 3.3 Only render tags when `agentMode === "team"` — pass `showMemberTags` hint or infer from `members.length > 0`

## 4. App.tsx — state, handlers, and message derivation

- [x] 4.1 Add `activeMemberName: string | null` state (init null), and corresponding ref (`activeMemberNameRef`)
- [x] 4.2 Add `handleMemberNav(direction: "prev" | "next")` — builds ordered list `["leader", ...members.map(m => m.name)]`, cycles `activeMemberName` through list
- [x] 4.3 Dispatch `prevMember` / `nextMember` actions in `useKeyboard` key handler (only when `agentMode === "team"`)
- [x] 4.4 Derive `displayMessages` via `useMemo`: when `activeMemberName` is non-null, call `client.getMember(activeMemberName)` → `mapSdkMessagesToTui(member.session.messages)`; when null, use current `messages` state
- [x] 4.5 If member is deleted while active, fall back to null + toast notification "Member `name` was removed"
- [x] 4.6 Pass `displayMessages` to `MessageList` instead of `messages`
- [x] 4.7 In `handlePrompt`, route input: `activeMemberName` non-null → `client.directMember(activeMemberName, "directive", text)`; else existing behavior
- [x] 4.8 When `activeMemberName` changes, scroll message list to bottom via `scrollRef.current.scrollTo(scrollHeight)`
- [x] 4.9 Pass `members` (from `client.listMembers()`) and `activeMemberName` to `InputBox`

## 5. Verification

- [x] 5.1 Run `bun run check` — typecheck + lint + test must all pass
- [x] 5.2 Manual smoke test: launch TUI in team mode, verify tags render, `[` / `]` cycle through members, messages display correctly, member input sends directives
- [x] 5.3 Verify non-team mode: tags hidden, `[` / `]` no-op
- [x] 5.4 Verify empty team: when no members exist, tags hidden, shortcuts no-op
