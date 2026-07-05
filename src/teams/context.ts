import type { MemberIndexStructure, MemberName, TaskState, TeamMdStructure } from "./types-v2.js";

// ─── L1: Identity ────────────────────────────────────────────

/** Build L1 (Identity) — agent definition's systemPrompt + role description. */
export function buildIdentityLayer(role: string, goal: string, agentSystemPrompt?: string): string {
	const parts: string[] = [];
	if (agentSystemPrompt) parts.push(agentSystemPrompt);
	parts.push(`You are a team member with role "${role}" and goal "${goal}".`);
	parts.push(
		'Use `memory` tool to read your memories and update your index, and `memory(action="write")` to save new learnings.',
	);
	return parts.join("\n\n");
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
	role: string;
	goal: string;
	agentSystemPrompt?: string;
	memberIndex: MemberIndexStructure | null;
	teamMd: TeamMdStructure;
	selfName: MemberName;
}): string[] {
	const l1 = buildIdentityLayer(opts.role, opts.goal, opts.agentSystemPrompt);
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
