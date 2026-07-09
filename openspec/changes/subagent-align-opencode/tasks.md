## 1. Subagent Tool Parameter Extension

- [ ] 1.1 Extend `src/tools/subagent.ts` — add optional DelegateTaskArgs-aligned parameters to SubagentParamsSchema: prompt, category, subagent_type, run_in_background (default false), task_id, command, load_skills (string[]). All new fields optional for backward compatibility.
- [ ] 1.2 Implement `subagent_type` → agent resolution — when subagent_type is provided, resolve to agent config via existing discoverAgents() + name matching; subagent_type and agent fields map to same internal resolution
- [ ] 1.3 Implement `load_skills` injection — when load_skills is provided, load skill content via SkillManager and inject into child session's resourceLoader system prompt
- [ ] 1.4 Implement `category` metadata — store category as metadata on the subagent result for display and task_metadata block; optionally append category-specific prompt hints

## 2. Subagent Async Mode + TaskRegistry

- [ ] 2.1 Create `src/agents/task-registry.ts` — TaskRegistry class tracking background tasks by ID (bg_xxx), storing: session reference, parent session ID, description, status, timestamps, agent/category metadata. Methods: register(), get(), complete(), cancel(), list(), listByParent()
- [ ] 2.2 Implement async execution in `src/agents/runner.ts` — when run_in_background=true: create AgentSession, prompt it, register in TaskRegistry, return bg_xxx ID immediately (do NOT await session.prompt())
- [ ] 2.3 Implement async completion notification — on child session agent_end event, mark TaskRegistry entry complete, inject completion note into parent session via steer (if streaming) or prompt (if idle), reusing the existing AgentServer notification path
- [ ] 2.4 Implement orphan cleanup — register async subagent sessions in AgentServer's setRebindSession hook, so cancelOrphansOnSessionChange disposes them when parent session switches
- [ ] 2.5 Implement `background_output` tool — fetch current output from a background task's session, support block/timeout/full_session/from_end/message_limit options
- [ ] 2.6 Implement `background_cancel` tool — abort a background task's session, remove from TaskRegistry, support individual taskId cancellation

## 3. Subagent Session Continuation

- [ ] 3.1 Implement `task_id` continuation in `src/agents/runner.ts` — when task_id (ses_...) is provided, look up existing session in TaskRegistry, call session.followUp(prompt) instead of creating a new session
- [ ] 3.2 Validate task_id — check session exists in registry and belongs to current parent session; return error if not found or belongs to different parent

## 4. Unified Result Format

- [ ] 4.1 Refactor `src/agents/runner.ts` result formatting — replace XML `<subagent-result>` with Markdown + `<task_metadata>` block aligned with oh-my-openagent's buildSyncTaskCompletion format
- [ ] 4.2 Update `src/tui/hooks/useSessionEvents.ts` — adapt subagent tool result parsing to handle Markdown + `<task_metadata>` format, extract metadata fields for SubagentMessageView rendering

## 5. Tool Registration

- [ ] 5.1 Register `background_output`, `background_cancel` tools in `src/agent/session.ts` — add to customTools array and tools allowlist in createSession, createRuntime, and handleSetAgentMode (per Pi SDK dual-registration pattern in AGENTS.md)
- [ ] 5.2 Update subagent tool description — mention new parameters (category, subagent_type, run_in_background, task_id, load_skills) in tool description/prompt snippet

## 6. TUI: SubagentMessageView Improvement

- [ ] 6.1 Improve `src/tui/components/SubagentMessageView.tsx` — enhance completed state display: add model name, category, duration fields; reduce border padding; make info lines more compact (single-line where possible)
- [ ] 6.2 Handle `<task_metadata>` in result rendering — extract task_metadata block from Markdown result, render structured metadata (session_id, category, subagent) as compact info line

## 7. TUI: Perspective Switching Extension

- [ ] 7.1 Extend `src/tui/App.tsx` handleMemberNav — expand navigation candidate list from `[null, ...members]` to `[null, ...members, ...subagentSessions]`, where subagentSessions come from TaskRegistry.listByParent(currentSessionId)
- [ ] 7.2 Subscribe to subagent session messages — when viewing a subagent session, reuse the existing subscribe pattern (App.tsx:158-220) to stream messages from the subagent's AgentSession
- [ ] 7.3 Route input to subagent session — when activeMemberName points to a subagent session, send input via subagent session's followUp/prompt instead of directMember
- [ ] 7.4 Extend InputBox perspective indicator — show subagent name prefix when viewing subagent session, reusing existing member indicator pattern in InputBox

## 8. TeamMember Full Tool Inheritance

- [ ] 8.1 Refactor `src/teams/manager-v2.ts` createMember — replace `filterMemberTools()` + `buildMemberCustomTools()` whitelist with full tool inheritance: use main session's tools allowlist minus NEVER_MEMBER_TOOLS (subagent/team/question)
- [ ] 8.2 Ensure MCP inheritance — when main session has MCP, member sessions automatically include "mcp" tool via McpManager, without manual assignedMcps specification
- [ ] 8.3 Keep assignedSkills/assignedMcps as override — if explicitly provided, they augment (not replace) the inherited tool set

## 9. Verification

- [ ] 9.1 Run `bun run check` — ensure typecheck + lint + test pass after all changes
- [ ] 9.2 Manual smoke test — dispatch sync subagent with new params, verify result format; dispatch async subagent, verify notification; switch perspective to subagent, verify streaming; create team member, verify full tool inheritance
