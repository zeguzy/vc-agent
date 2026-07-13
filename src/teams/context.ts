import type { MemberIndexStructure, MemberName, TaskState, TeamMdStructure } from "./types-v2.js";

// ─── Context Layer Architecture ──────────────────────────────
//
// Context is organized into five layers by information type and lifecycle,
// not by data source. This ensures:
//   - Same-type info is co-located (no scatter)
//   - Single layer doesn't mix lifecycle categories (no conflation)
//   - Compaction reinject knows which layers are mandatory contracts
//
// Layer A: Contract      — behavioral contract, MUST always be present
// Layer B: Tool Contract — tool list + work method, can degrade after compaction
// Layer C: Team Static   — mission + members (low-frequency change)
// Layer D: Runtime       — current task + active context + recent activity (per-task change)
// Layer E: Index         — memory index + task overview + notes (medium-frequency change)
//
// System prompt = [A, B, C, D, E]
// Compaction reinject = [A, C, D]  (fixes the previous bug where L1 was lost)

// ─── Layer A: Contract ──────────────────────────────────────

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

/**
 * Build the Anti-Patterns section: universal fallback constraints always
 * present, plus optional leader-provided role-specific constraints appended.
 * `constraints` text appears ONLY here (never in Identity).
 */
export function buildMemberAntiPatternsSection(
	customConstraints?: string,
	isDiscussionParticipant?: boolean,
): string {
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
	lines.push(
		'**Reading is not verification.** Looking at code and thinking "this looks right" is not the same as running it. Verify by executing: run the test, run the build, reproduce the bug. Claims without evidence are speculation.',
	);
	if (isDiscussionParticipant) {
		lines.push("");
		lines.push("**Discussion participant failures:**");
		lines.push(
			"- **Going off-topic**: stay on the discussion agenda. If you have a related but separate point, note it briefly and return to the current topic.",
		);
		lines.push(
			"- **Monopolizing the floor**: contribute your perspective, then let others speak. Don't respond again immediately unless the supervisor directs you.",
		);
		lines.push(
			"- **Ignoring redirects**: if the supervisor redirects you, follow the new direction immediately. Don't continue on your previous tangent.",
		);
	}
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
	"Before escalating BLOCKED or NEEDS_CONTEXT to the leader, consider messaging a teammate — they may already know the answer. Proactive communication beats silent spinning.",
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

/** Build Layer A (Contract) — the behavioral contract that MUST always be present. */
export function buildContractLayer(opts: {
	name: MemberName;
	role: string;
	goal: string;
	constraints?: string;
	isDiscussionParticipant?: boolean;
}): string {
	const hasConstraints = Boolean(opts.constraints?.trim());
	const sections: string[] = [
		buildMemberIdentitySection(opts.name, opts.role, opts.goal, hasConstraints),
		buildMemberAntiPatternsSection(opts.constraints, opts.isDiscussionParticipant),
		MEMBER_ESCALATION_SECTION,
		MEMBER_OUTPUT_PROTOCOL_SECTION,
	];
	return sections.join("\n\n");
}

// ─── Layer B: Tool Contract ──────────────────────────────────

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

/** Build Layer B (Tool Contract) — tools + work method. Can degrade after compaction. */
export function buildToolContractLayer(opts: {
	tools: string[];
	skills?: string[];
	mcps?: string[];
}): string {
	const { tools, skills, mcps } = opts;
	const lines: string[] = [];
	lines.push("## Your Tools");
	lines.push("");
	lines.push(`You have these tools: ${tools.map((t) => `\`${t}\``).join(", ")}.`);
	if (tools.includes("mcp") && mcps && mcps.length > 0) {
		lines.push("");
		lines.push(`MCP servers available: ${mcps.map((m) => `\`${m}\``).join(", ")}.`);
	}
	if (skills && skills.length > 0) {
		lines.push("");
		lines.push(
			`You've been assigned these skills: ${skills.map((s) => `\`${s}\``).join(", ")}. Invoke them with \`/skill-name\` when relevant.`,
		);
	}
	lines.push("");
	lines.push(MEMBER_WORK_DISCIPLINE_SECTION);
	return lines.join("\n");
}

// ─── Layer C: Team Static ────────────────────────────────────

/** Build Layer C (Team Static) — mission + members table (low-frequency change). */
export function buildTeamStaticLayer(teamMd: TeamMdStructure, selfName?: MemberName): string {
	const lines: string[] = ["[Team Overview]"];
	lines.push(`Mission: ${teamMd.mission}`);
	lines.push("");
	lines.push("Members:");
	for (const m of teamMd.members) {
		const isSelf = m.name === selfName;
		const marker = isSelf ? "→ " : "  ";
		const taskInfo = m.currentTask ? ` — ${m.currentTask}` : "";
		lines.push(`${marker}${m.name} (${m.role}) — ${m.status}${taskInfo}`);
	}
	return lines.join("\n");
}

// ─── Layer D: Runtime ────────────────────────────────────────

/** Build Layer D (Runtime) — current task + active context + recent activity. */
export function buildRuntimeLayer(opts: {
	activeContext?: string;
	recentActivity?: Array<{ date: string; entry: string }>;
	currentTask?: TaskState;
}): string {
	const lines: string[] = ["[Your Current State]"];

	if (opts.currentTask) {
		lines.push(`Task: ${opts.currentTask.id}: ${opts.currentTask.title}`);
		if (opts.currentTask.description) lines.push(`  ${opts.currentTask.description}`);
		lines.push(`  Priority: ${opts.currentTask.priority}`);
	} else if (opts.activeContext) {
		lines.push(`Focus: ${opts.activeContext}`);
	}

	if (opts.recentActivity && opts.recentActivity.length > 0) {
		lines.push("");
		lines.push("Recent:");
		for (const a of opts.recentActivity.slice(-5)) {
			lines.push(`  - ${a.date}: ${a.entry}`);
		}
	}

	return lines.join("\n");
}

// ─── Layer E: Index ──────────────────────────────────────────

/** Build Layer E (Index) — memory index + task overview + important notes. */
export function buildIndexLayer(opts: {
	memoryIndex: Array<{ file: string; type: string; description: string }>;
	activeTasks: TaskState[];
	importantNotes?: string;
}): string {
	const lines: string[] = ["[Indexes]"];

	if (opts.activeTasks.length > 0) {
		lines.push("Active Tasks:");
		for (const t of opts.activeTasks) {
			const check = t.done ? "✓" : "○";
			const assignee = t.memberName ? `@${t.memberName}` : "unassigned";
			lines.push(`  ${check} ${t.id}: ${t.title} → ${assignee}`);
		}
	}

	if (opts.importantNotes) {
		lines.push("");
		lines.push(`Important: ${opts.importantNotes}`);
	}

	if (opts.memoryIndex.length > 0) {
		lines.push("");
		lines.push("Memories:");
		for (const m of opts.memoryIndex) {
			lines.push(`  - ${m.file} [${m.type}] — ${m.description}`);
		}
	}

	return lines.join("\n");
}

// ─── Topic (on-demand, not part of system prompt) ───────────

/** Build topic content (returned by memory tool, not part of system prompt). */
export function buildTopicLayer(topic: string, type: string, content: string): string {
	return `[Memory: ${topic} (${type})]\n${content}`;
}

/** @deprecated Use buildRuntimeLayer instead. */
export function buildTaskLayer(task: TaskState): string {
	return buildRuntimeLayer({ currentTask: task });
}

// ─── Full System Prompt Builder ──────────────────────────────

/** Build the full system prompt for a member session [A, B, C, D, E]. */
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
	isDiscussionParticipant?: boolean;
}): string[] {
	const assignedTools = opts.assignedTools ?? ["read", "bash", "grep", "find", "memory", "message"];

	const a = buildContractLayer({
		name: opts.name,
		role: opts.role,
		goal: opts.goal,
		constraints: opts.constraints,
		isDiscussionParticipant: opts.isDiscussionParticipant,
	});

	const b = buildToolContractLayer({
		tools: assignedTools,
		skills: opts.assignedSkills,
		mcps: opts.assignedMcps,
	});

	const c = buildTeamStaticLayer(opts.teamMd, opts.selfName);

	const memberIndex = opts.memberIndex;
	const currentTask = opts.teamMd.activeTasks.find(
		(t) => t.memberName === opts.selfName && !t.done,
	);
	const d = buildRuntimeLayer({
		activeContext: memberIndex?.activeContext,
		recentActivity: memberIndex?.recentActivity,
		currentTask,
	});

	const e = buildIndexLayer({
		memoryIndex: memberIndex?.memoryIndex ?? [],
		activeTasks: opts.teamMd.activeTasks,
		importantNotes: opts.teamMd.importantNotes || undefined,
	});

	return [a, b, c, d, e];
}

/** Build re-injection content after compaction: [A, C, D]. */
export function buildCompactionReinject(opts: {
	name: MemberName;
	role: string;
	goal: string;
	constraints?: string;
	memberIndex: MemberIndexStructure;
	teamMd: TeamMdStructure;
	selfName: MemberName;
	isDiscussionParticipant?: boolean;
}): string {
	const a = `[Contract Re-injected]\n${buildContractLayer({
		name: opts.name,
		role: opts.role,
		goal: opts.goal,
		constraints: opts.memberIndex.constraints,
		isDiscussionParticipant: opts.isDiscussionParticipant,
	})}`;

	const c = `[Team Overview Re-injected]\n${buildTeamStaticLayer(opts.teamMd, opts.selfName)}`;

	const currentTask = opts.teamMd.activeTasks.find(
		(t) => t.memberName === opts.selfName && !t.done,
	);
	const d = `[Your Current State Re-injected]\n${buildRuntimeLayer({
		activeContext: opts.memberIndex.activeContext,
		recentActivity: opts.memberIndex.recentActivity,
		currentTask,
	})}`;

	return `${a}\n\n${c}\n\n${d}`;
}
