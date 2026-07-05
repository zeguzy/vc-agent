import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { TeamManagerLike } from "../teams/types-v2.js";

interface TeamReadToolOptions {
	manager: TeamManagerLike;
}

const TeamReadParamsSchema = Type.Object({});

export function createTeamReadTool(opts: TeamReadToolOptions): ToolDefinition {
	return {
		name: "team-read",
		label: "Team Read",
		description:
			"Read the TEAM.md file to understand the team's current state: mission, members, active tasks, and important notes. Use this to check who is available and what work is in progress.",
		parameters: TeamReadParamsSchema,
		async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
			try {
				const teamMd = opts.manager.readTeamMd();
				const lines: string[] = [];
				if (teamMd.mission) lines.push(`Mission: ${teamMd.mission}`);
				if (teamMd.members.length > 0) {
					lines.push("");
					lines.push("Members:");
					for (const m of teamMd.members) {
						lines.push(`  ${m.name} (${m.role}) — ${m.status} — ${m.currentTask}`);
					}
				}
				if (teamMd.activeTasks.length > 0) {
					lines.push("");
					lines.push("Active Tasks:");
					for (const t of teamMd.activeTasks) {
						const check = t.done ? "✓" : "○";
						const assignee = t.memberName ? `@${t.memberName}` : "unassigned";
						lines.push(`  ${check} ${t.id}: ${t.title} → ${assignee}`);
					}
				}
				if (teamMd.importantNotes) {
					lines.push("");
					lines.push(`Important: ${teamMd.importantNotes}`);
				}
				if (teamMd.sharedMemoryIndex.length > 0) {
					lines.push("");
					lines.push("Shared Memory:");
					for (const s of teamMd.sharedMemoryIndex) {
						lines.push(`  ${s.path} — ${s.description}`);
					}
				}
				return { content: [{ type: "text" as const, text: lines.join("\n") || "Team is empty — no members or tasks yet." }], details: {} };
			} catch (err) {
				return { content: [{ type: "text" as const, text: `Error reading team state: ${err}` }], details: {}, isError: true };
			}
		},
	};
}
