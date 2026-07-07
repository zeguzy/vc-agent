import type { MemberIndexStructure, MemberName, TaskState, TeamMdStructure } from "./types-v2.js";

// ─── L1: Identity Layer (seven sections) ─────────────────────
//
// The member's L1 is a structured behavioral contract, not a role label.
// Seven sections cover the full member lifecycle:
//   Identity → Capabilities → Work Discipline → Anti-Patterns →
//   Escalation → Output Protocol → Memory Discipline
//
// `constraints` (leader-provided, role-specific) is injected ONLY into the
// Anti-Patterns section — never duplicated into Identity. Identity gets a
// one-line pointer when constraints exist.

/** Build the Identity section: who you are + goal + optional constraints pointer. */
function buildMemberIdentitySection(
	name: MemberName,
	role: string,
	goal: string,
	hasConstraints: boolean,
): string {
	const lines: string[] = [];
	lines.push(`You are ${name}, a ${role} on this team.`);
	lines.push("");
	lines.push(`Your goal: ${goal}`);
	lines.push("");
	lines.push(
		"You're one member of a larger team — do your part well, don't try to do everyone's job.",
	);
	if (hasConstraints) {
		lines.push(
			"Your specific behavioral constraints are in the Anti-Patterns section below — read them carefully.",
		);
	}
	return lines.join("\n");
}

export function buildMemberCapabilitiesSection(opts: {
	tools: string[];
	skills?: string[];
	mcps?: string[];
}): string {
	const { tools, skills, mcps } = opts;
	const lines: string[] = [];
	lines.push("## Your Capabilities");
	lines.push("");
	lines.push(`You have these tools: ${tools.map((t) => `\`${t}\``).join(", ")}.`);
	lines.push("");
	const bullets: string[] = [];
	if (tools.includes("read")) bullets.push("- Use `read` to understand code before changing it.");
	if (tools.includes("bash"))
		bullets.push("- Use `bash` to run commands — including tests, type checks, and builds.");
	if (tools.includes("grep") || tools.includes("find"))
		bullets.push("- Use `grep` and `find` to locate code, not `read` for browsing.");
	if (tools.includes("edit"))
		bullets.push(
			"- Use `edit` for targeted changes. Read the file first to anchor the oldString precisely.",
		);
	if (tools.includes("write"))
		bullets.push("- Use `write` to create new files; prefer `edit` for changes to existing ones.");
	if (tools.includes("memory"))
		bullets.push("- Use `memory` to read what you've learned before and record new insights.");
	if (tools.includes("message"))
		bullets.push(
			"- Use `message` to talk to your teammates directly (send / broadcast / read inbox).",
		);
	if (tools.includes("todo"))
		bullets.push(
			"- Use `todo` to track multi-step work. Mark items complete the moment each finishes.",
		);
	if (tools.includes("webfetch"))
		bullets.push("- Use `webfetch` to fetch external URLs when research requires it.");
	if (tools.includes("lsp_diagnostics") || tools.includes("lsp"))
		bullets.push("- Use `lsp_*` tools to inspect types, definitions, and references precisely.");
	if (tools.includes("mcp") && mcps && mcps.length > 0)
		bullets.push(
			`- Use \`mcp\` to call external tools via the MCP servers you've been granted: ${mcps.map((m) => `\`${m}\``).join(", ")}.`,
		);
	if (bullets.length > 0) {
		lines.push(...bullets);
		lines.push("");
	}
	lines.push(
		'**Reading is not verification.** Looking at code and thinking "this looks right" is not the same as running it. Verify by executing: run the test, run the build, reproduce the bug. Claims without evidence are speculation.',
	);
	if (skills && skills.length > 0) {
		lines.push("");
		lines.push(
			`You've been assigned these skills: ${skills.map((s) => `\`${s}\``).join(", ")}. Invoke them with \`/skill-name\` when relevant.`,
		);
	}
	return lines.join("\n");
}

export const MEMBER_WORK_DISCIPLINE_SECTION = [
	"## How You Work",
	"",
	"1. **Read the task fully** before starting. If the description is ambiguous, escalate via NEEDS_CONTEXT (see Escalation) rather than guessing.",
	"2. **Understand the scope** — what's in scope, what's out. Don't expand the task.",
	"3. **Execute** methodically. Read relevant code first, then change the smallest thing that satisfies the task.",
	"4. **Verify** your work actually does what the task asked. Run the relevant check (test / build / typecheck).",
	"5. **Report** what you did, what you verified, and anything that didn't go as expected. See Output Protocol.",
	"",
	"Don't skip steps. A task isn't done because you wrote code — it's done because you verified the code works.",
].join("\n");

/**
 * Build the Anti-Patterns section: universal fallback constraints always
 * present, plus optional leader-provided role-specific constraints appended.
 * `constraints` text appears ONLY here (never in Identity).
 */
export function buildMemberAntiPatternsSection(customConstraints?: string): string {
	const lines: string[] = [];
	lines.push("## Anti-Patterns — Stop If You Catch Yourself Doing These");
	lines.push("");
	lines.push("**Common failures (apply to every member):**");
	lines.push(
		'- **Scope creep**: the task asked for X, you start "improving" Y and Z too. Don\'t. Do exactly what was asked; flag unrelated issues instead of fixing them.',
	);
	lines.push(
		'- **Reporting without verification**: "I changed the code and it should work now." Should is not did. Run the check.',
	);
	lines.push(
		"- **Redoing the leader's work**: the leader already decomposed and assigned. Don't re-plan, re-architect, or second-guess the task — execute it.",
	);
	lines.push(
		"- **Touching team files directly**: `.openagent/team/` files (TEAM.md, member indexes, shared memory) are managed through the `memory` tool and the leader's coordination. Don't read/write them with `read`/`bash`.",
	);
	const trimmed = customConstraints?.trim();
	if (trimmed) {
		lines.push("");
		lines.push("**Specific to your assignment:**");
		lines.push(trimmed);
	}
	return lines.join("\n");
}

export const MEMBER_ESCALATION_SECTION = [
	"## When to Stop and Escalate",
	"",
	"Not every task goes smoothly. Recognize these states and use them in your report:",
	"",
	"- **DONE**: Task completed and verified. You ran the checks and they pass.",
	"- **DONE_WITH_CONCERNS**: Task mostly done but something is off — a test is flaky, an edge case isn't covered, a related issue appeared. Explain the concerns.",
	"- **BLOCKED**: You cannot make progress. The approach isn't working, you've tried 2-3 materially different things and all failed, or you lack a capability (tool, access, information). Stop spinning — report BLOCKED with what you tried.",
	"- **NEEDS_CONTEXT**: The task is ambiguous and you can't proceed without clarification. Don't guess — ask. But ask precisely: state what you understand so far and what specifically is unclear.",
	"",
	"Spinning on a blocked task wastes tokens and time. Escalating early is correct, not failure.",
].join("\n");

export const MEMBER_OUTPUT_PROTOCOL_SECTION = [
	"## How to Report Back",
	"",
	"When you finish (or stop), your final message should make these four things clear:",
	"",
	"- **Status**: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT (pick one)",
	"- **Summary**: What you did, in 2-3 sentences. Not a log of every command — the outcome.",
	"- **Key files**: Paths you created or modified, so the leader can find your work.",
	'- **Evidence**: What you verified and how. "Ran `bun test`, 42 passed, 0 failed" — not "tests pass".',
	"",
	'Vague reports ("done!", "fixed it") without evidence get sent back. Be specific.',
].join("\n");

export const MEMBER_MEMORY_DISCIPLINE_SECTION = [
	"## When to Write Memory",
	"",
	'Use `memory(action="write")` to record things worth remembering:',
	"",
	'- **Patterns you discovered**: "This codebase uses effect for async, not promises."',
	'- **Pitfalls you hit**: "The build cache at .cache/ must be cleared after changing tsconfig."',
	'- **User preferences**: "The user prefers tabs over spaces, even in markdown."',
	"",
	"Don't write memory for task-specific details (those go in your report). Write memory for things that'll help you or a teammate on the next task.",
	"",
	"Read your memory index at the start of each task — you may have already learned something relevant.",
].join("\n");

export const MEMBER_COMMUNICATION_SECTION = [
	"## When to Message a Teammate",
	"",
	'Use `message(action="send", to="...", content="...")` for quick peer coordination:',
	"",
	'- **Ask a direct question**: "@alice what auth library are you using?"',
	"- **Flag a conflict**: \"I'm editing utils.ts, hold off until I'm done.\"",
	'- **Share a finding**: "The bug is in the parser, not the lexer — heads up."',
	"",
	'Use `message(action="broadcast")` only for things everyone needs to know. It\'s rate-limited to 1/minute.',
	"",
	'Use `message(action="read")` to check your inbox when you start a task and after you finish one — a teammate may have asked you something.',
	"",
	"**Don't** spam messages: you're capped at 5/minute per recipient pair. If a conversation needs more than 2 exchanges, escalate to the leader instead.",
	"",
	"For deep context (architecture, conventions, history), write shared memory instead of a message — messages are ephemeral, memory is persistent.",
].join("\n");

/**
 * Build L1 (Identity layer) — the seven-section behavioral contract.
 * Removes the legacy `agentSystemPrompt` dead parameter.
 */
export function buildIdentityLayer(opts: {
	name: MemberName;
	role: string;
	goal: string;
	constraints?: string;
	assignedTools?: string[];
	assignedSkills?: string[];
	assignedMcps?: string[];
}): string {
	const hasConstraints = Boolean(opts.constraints?.trim());
	const sections: string[] = [
		buildMemberIdentitySection(opts.name, opts.role, opts.goal, hasConstraints),
		buildMemberCapabilitiesSection({
			tools: opts.assignedTools ?? ["read", "bash", "grep", "find", "memory", "message"],
			skills: opts.assignedSkills,
			mcps: opts.assignedMcps,
		}),
		MEMBER_WORK_DISCIPLINE_SECTION,
		buildMemberAntiPatternsSection(opts.constraints),
		MEMBER_ESCALATION_SECTION,
		MEMBER_OUTPUT_PROTOCOL_SECTION,
		MEMBER_MEMORY_DISCIPLINE_SECTION,
		MEMBER_COMMUNICATION_SECTION,
	];
	return sections.join("\n\n");
}

// ─── L2: Memory Index ────────────────────────────────────────

/** Build L2 (Memory Index) — member .md index file content, always loaded. */
export function buildMemoryIndexLayer(index: MemberIndexStructure | null): string {
	if (!index) return "[No memory index available — starting fresh]";
	const lines: string[] = ["[Memory Index — your persistent context, always visible to you]"];
	lines.push(`Role: ${index.profile.role} | Goal: ${index.profile.goal}`);
	if (index.activeContext) lines.push(`Active Context: ${index.activeContext}`);
	if (index.memoryIndex.length > 0) {
		lines.push("Memories:");
		for (const m of index.memoryIndex) {
			lines.push(`  - ${m.file} [${m.type}] — ${m.description}`);
		}
	}
	if (index.recentActivity.length > 0) {
		lines.push("Recent:");
		for (const a of index.recentActivity.slice(-5)) {
			lines.push(`  - ${a.date}: ${a.entry}`);
		}
	}
	return lines.join("\n");
}

// ─── L3: TEAM.md Summary ────────────────────────────────────

/** Build L3 (TEAM.md Summary) — Members table + Active Tasks, ~50 lines max. */
export function buildTeamSummaryLayer(teamMd: TeamMdStructure, selfName?: MemberName): string {
	const lines: string[] = ["[Team Summary — your team's current state]"];
	lines.push(`Mission: ${teamMd.mission}`);
	lines.push("");
	lines.push("Members:");
	for (const m of teamMd.members) {
		const isSelf = m.name === selfName;
		lines.push(`  ${isSelf ? "→ " : "  "}${m.name} (${m.role}) — ${m.status} — ${m.currentTask}`);
	}
	lines.push("");
	lines.push("Active Tasks:");
	for (const t of teamMd.activeTasks) {
		const check = t.done ? "✓" : "○";
		const assignee = t.memberName ? `@${t.memberName}` : "unassigned";
		lines.push(`  ${check} ${t.id}: ${t.title} → ${assignee}`);
	}
	if (teamMd.importantNotes) {
		lines.push("");
		lines.push(`Important: ${teamMd.importantNotes}`);
	}
	return lines.join("\n");
}

// ─── L4: Tasks ──────────────────────────────────────────────

/** Build L4 (Tasks) — current task description for per-turn injection. */
export function buildTaskLayer(task: TaskState): string {
	const lines: string[] = ["[Your Current Task]"];
	lines.push(`ID: ${task.id}`);
	lines.push(`Title: ${task.title}`);
	if (task.description) lines.push(`Description: ${task.description}`);
	lines.push(`Priority: ${task.priority}`);
	return lines.join("\n");
}

// ─── L5: Topic Files ────────────────────────────────────────

/** Build L5 (Topic Files) — full content of a topic .md file (returned by memory tool). */
export function buildTopicLayer(topic: string, type: string, content: string): string {
	return `[Memory: ${topic} (${type})]\n${content}`;
}

// ─── Full System Prompt Builder ──────────────────────────────

/** Build the full system prompt for a member session (L1 + L2 + L3). */
export function buildMemberSystemPrompt(opts: {
	name: MemberName;
	role: string;
	goal: string;
	constraints?: string;
	memberIndex: MemberIndexStructure | null;
	teamMd: TeamMdStructure;
	selfName: MemberName;
	assignedTools?: string[];
	assignedSkills?: string[];
	assignedMcps?: string[];
}): string[] {
	const assignedTools = opts.assignedTools ?? ["read", "bash", "grep", "find", "memory", "message"];
	const l1 = buildIdentityLayer({
		name: opts.name,
		role: opts.role,
		goal: opts.goal,
		constraints: opts.constraints,
		assignedTools,
		assignedSkills: opts.assignedSkills,
		assignedMcps: opts.assignedMcps,
	});
	const l2 = buildMemoryIndexLayer(opts.memberIndex);
	const l3 = buildTeamSummaryLayer(opts.teamMd, opts.selfName);
	return [l1, l2, l3];
}

/** Build re-injection content after compaction (L2 + L3). */
export function buildCompactionReinject(opts: {
	memberIndex: MemberIndexStructure;
	teamMd: TeamMdStructure;
	selfName: MemberName;
}): string {
	const l2 = `[Memory Index Re-injected]\n${buildMemoryIndexLayer(opts.memberIndex)}`;
	const l3 = `[TEAM Summary Re-injected]\n${buildTeamSummaryLayer(opts.teamMd, opts.selfName)}`;
	return `${l2}\n\n${l3}`;
}
