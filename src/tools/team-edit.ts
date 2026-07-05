import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { TeamManagerLike } from "../teams/types-v2.js";

interface TeamEditToolOptions {
	manager: TeamManagerLike;
}

const SectionSchema = Type.Union(
	[
		Type.Literal("mission"),
		Type.Literal("active-tasks"),
		Type.Literal("important-notes"),
	],
	{ description: "Which section of TEAM.md to edit" },
);

const TeamEditParamsSchema = Type.Object({
	section: SectionSchema,
	content: Type.String({ description: "New content for the section" }),
	action: Type.Optional(
		Type.Union([
			Type.Literal("add-member"),
			Type.Literal("remove-member"),
			Type.Literal("add-task"),
			Type.Literal("complete-task"),
		], { description: "Structured action instead of raw content edit" }),
	),
	name: Type.Optional(Type.String({ description: "Member name for add-member/remove-member" })),
	role: Type.Optional(Type.String({ description: "Member role for add-member" })),
	goal: Type.Optional(Type.String({ description: "Member goal for add-member" })),
	title: Type.Optional(Type.String({ description: "Task title for add-task" })),
	description: Type.Optional(Type.String({ description: "Task description for add-task" })),
	taskId: Type.Optional(Type.String({ description: "Task ID for complete-task" })),
	priority: Type.Optional(
		Type.Union([Type.Literal("high"), Type.Literal("medium"), Type.Literal("low")]),
	),
});

export function createTeamEditTool(opts: TeamEditToolOptions): ToolDefinition {
	return {
		name: "team-edit",
		label: "Team Edit",
		description:
			"Edit the TEAM.md file as the team leader. Use this to update the mission, add/remove members, assign tasks, or update important notes. Only the leader can use this tool.",
		parameters: TeamEditParamsSchema,
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const args = params as {
				section: string; content: string; action?: string; name?: string;
				role?: string; goal?: string; title?: string; description?: string;
				taskId?: string; priority?: string;
			};
			try {
				const teamMd = opts.manager.readTeamMd();

				if (args.action === "add-member") {
					if (!args.name) throw new Error("name is required for add-member");
					if (!args.role) throw new Error("role is required for add-member");
					if (!args.goal) throw new Error("goal is required for add-member");
					const state = await opts.manager.createMember({
						name: args.name,
						role: args.role,
						goal: args.goal,
						model: undefined,
						services: {} as any, // filled by TeamManager internally
						parentModel: undefined,
					});
					return { content: [{ type: "text" as const, text: `Member "${args.name}" (${args.role}) created. Status: ${state.status}` }], details: {} };
				}

				if (args.action === "remove-member") {
					if (!args.name) throw new Error("name is required for remove-member");
					await opts.manager.removeMember(args.name);
					return { content: [{ type: "text" as const, text: `Member "${args.name}" removed and archived.` }], details: {} };
				}

				if (args.action === "add-task") {
					if (!args.title) throw new Error("title is required for add-task");
					if (!args.name) throw new Error("name (member) is required for add-task");
					const task = opts.manager.assignTask({
						title: args.title,
						description: args.description ?? "",
						memberName: args.name,
						priority: args.priority as "high" | "medium" | "low" | undefined,
					});
					return { content: [{ type: "text" as const, text: `Task ${task.id} "${task.title}" assigned to @${args.name}.` }], details: {} };
				}

				if (args.action === "complete-task") {
					if (!args.taskId) throw new Error("taskId is required for complete-task");
					opts.manager.completeTask(args.taskId);
					return { content: [{ type: "text" as const, text: `Task ${args.taskId} completed.` }], details: {} };
				}

				// Raw section edit
				if (args.section === "mission") {
					teamMd.mission = args.content;
				} else if (args.section === "important-notes") {
					teamMd.importantNotes = args.content;
				} else if (args.section === "active-tasks") {
					// For raw active-tasks edit, just update important notes about tasks
					teamMd.importantNotes = args.content;
				}

				return { content: [{ type: "text" as const, text: `TEAM.md ${args.section} updated.` }], details: {} };
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				return { content: [{ type: "text" as const, text: `Error: ${msg}` }], details: {}, isError: true };
			}
		},
	};
}
