import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { TeamManagerLike, TeamManagerRef } from "../teams/types-v2.js";

interface TeamToolOptions {
	teamRef: TeamManagerRef;
}

const ActionSchema = Type.Union(
	[
		Type.Literal("read"),
		Type.Literal("create"),
		Type.Literal("assign"),
		Type.Literal("direct"),
		Type.Literal("edit-member"),
		Type.Literal("complete"),
		Type.Literal("remove"),
	],
	{ description: "Action to perform on the team" },
);

const TeamParamsSchema = Type.Object({
	action: ActionSchema,
	name: Type.Optional(
		Type.String({ description: "Member name (for create/assign/direct/edit-member/remove)" }),
	),
	role: Type.Optional(Type.String({ description: "Member role (for create)" })),
	goal: Type.Optional(Type.String({ description: "Member goal (for create)" })),
	taskTitle: Type.Optional(
		Type.String({
			description: "First task title (for create) — member starts working immediately",
		}),
	),
	taskDescription: Type.Optional(
		Type.String({ description: "First task description (for create)" }),
	),
	taskPriority: Type.Optional(
		Type.Union([Type.Literal("high"), Type.Literal("medium"), Type.Literal("low")]),
	),
	title: Type.Optional(Type.String({ description: "Task title (for assign)" })),
	description: Type.Optional(Type.String({ description: "Task description (for assign)" })),
	priority: Type.Optional(
		Type.Union([Type.Literal("high"), Type.Literal("medium"), Type.Literal("low")]),
	),
	taskId: Type.Optional(Type.String({ description: "Task ID (for complete)" })),
	kind: Type.Optional(
		Type.Union([Type.Literal("directive"), Type.Literal("context"), Type.Literal("redirect")]),
	),
	payload: Type.Optional(Type.String({ description: "Message content (for direct)" })),
	section: Type.Optional(Type.Union([Type.Literal("goal"), Type.Literal("active-context")])),
	content: Type.Optional(Type.String({ description: "New content (for edit-member)" })),
});

export function createTeamTool(opts: TeamToolOptions): ToolDefinition {
	return {
		name: "team",
		label: "Team",
		description:
			"Manage your team. Actions:\n" +
			"- read: See who's on the team, what they're working on, current tasks.\n" +
			"- create: Add a member. Give them a name, role, and goal. Optionally include taskTitle + taskDescription to start them working right away.\n" +
			'  Example: team(action="create", name="sasha", role="frontend dev", goal="Build the login page", taskTitle="Login page", taskDescription="Create Login.tsx with email+password form")\n' +
			"- assign: Give a task to an idle member. They'll start working on it.\n" +
			'  Example: team(action="assign", name="sasha", title="Add validation", description="Validate email format before submit")\n' +
			'- direct: Send a message to a member mid-task. kind="directive" (change approach), "context" (extra info), "redirect" (new priority).\n' +
			'  Example: team(action="direct", name="sasha", kind="context", payload="The design file is at /docs/mockup.fig")\n' +
			"- edit-member: Update a member's goal or active-context.\n" +
			"- complete: Mark a task as done by its ID.\n" +
			"- remove: Remove a member from the team. Only use this when the user explicitly asks to remove someone — finished members stay idle and available for new tasks.",
		parameters: TeamParamsSchema,
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const manager = opts.teamRef.current;
			if (!manager) return err("Team manager not available yet — try again in a moment.");
			const args = params as {
				action: string;
				name?: string;
				role?: string;
				goal?: string;
				taskTitle?: string;
				taskDescription?: string;
				taskPriority?: string;
				title?: string;
				description?: string;
				priority?: string;
				taskId?: string;
				kind?: string;
				payload?: string;
				section?: string;
				content?: string;
			};
			try {
				switch (args.action) {
					case "read":
						return handleRead(manager);
					case "create":
						return await handleCreate(manager, args);
					case "assign":
						return handleAssign(manager, args);
					case "direct":
						return handleDirect(manager, args);
					case "edit-member":
						return handleEditMember(manager, args);
					case "complete":
						return handleComplete(manager, args);
					case "remove":
						return await handleRemove(manager, args);
					default:
						return err(`Unknown action: ${args.action}`);
				}
			} catch (e) {
				return err(e instanceof Error ? e.message : String(e));
			}
		},
	};
}

function handleRead(manager: TeamManagerLike) {
	const teamMd = manager.readTeamMd();
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
	return ok(lines.join("\n") || "Team is empty — no members or tasks yet.");
}

async function handleCreate(manager: TeamManagerLike, args: Record<string, unknown>) {
	const name = args.name as string | undefined;
	const role = args.role as string | undefined;
	const goal = args.goal as string | undefined;
	if (!name) return err("name is required for create");
	if (!role) return err("role is required for create");
	if (!goal) return err("goal is required for create");

	const state = await manager.createMember({
		name,
		role,
		goal,
		model: undefined,
		services: {} as never,
		parentModel: undefined,
	});

	const taskTitle = args.taskTitle as string | undefined;
	if (taskTitle) {
		const task = manager.assignTask({
			title: taskTitle,
			description: (args.taskDescription as string) ?? "",
			memberName: name,
			priority: (args.taskPriority as "high" | "medium" | "low" | undefined) ?? "medium",
		});
		return ok(
			`Member "${name}" (${role}) created and working on "${taskTitle}" [${task.id}]. Status: active`,
		);
	}

	return ok(`Member "${name}" (${role}) created. Status: ${state.status}`);
}

function handleAssign(manager: TeamManagerLike, args: Record<string, unknown>) {
	const name = args.name as string | undefined;
	const title = args.title as string | undefined;
	if (!name) return err("name (member) is required for assign");
	if (!title) return err("title is required for assign");
	const task = manager.assignTask({
		title,
		description: (args.description as string) ?? "",
		memberName: name,
		priority: (args.priority as "high" | "medium" | "low" | undefined) ?? "medium",
	});
	return ok(`Task ${task.id} "${title}" assigned to @${name}. Member is now active.`);
}

function handleDirect(manager: TeamManagerLike, args: Record<string, unknown>) {
	const name = args.name as string | undefined;
	const kind = args.kind as "directive" | "context" | "redirect" | undefined;
	const payload = args.payload as string | undefined;
	if (!name) return err("name is required for direct");
	if (!kind) return err("kind is required for direct");
	if (!payload) return err("payload is required for direct");
	manager.directMember(name, kind, payload);
	return ok(`Message sent to ${name} [${kind}].`);
}

function handleEditMember(manager: TeamManagerLike, args: Record<string, unknown>) {
	const name = args.name as string | undefined;
	const section = args.section as "goal" | "active-context" | undefined;
	const content = args.content as string | undefined;
	if (!name) return err("name is required for edit-member");
	if (!section) return err("section is required for edit-member");
	if (!content) return err("content is required for edit-member");

	const index = manager.readMemberIndex(name);
	if (!index) return err(`Member "${name}" index not found.`);

	if (section === "active-context") {
		index.activeContext = content;
	} else if (section === "goal") {
		index.profile.goal = content;
	}

	return ok(`Member "${name}" ${section} updated.`);
}

function handleComplete(manager: TeamManagerLike, args: Record<string, unknown>) {
	const taskId = args.taskId as string | undefined;
	if (!taskId) return err("taskId is required for complete");
	manager.completeTask(taskId);
	return ok(`Task ${taskId} completed.`);
}

async function handleRemove(manager: TeamManagerLike, args: Record<string, unknown>) {
	const name = args.name as string | undefined;
	if (!name) return err("name is required for remove");
	await manager.removeMember(name);
	return ok(`Member "${name}" removed and archived.`);
}

function ok(text: string) {
	return { content: [{ type: "text" as const, text }], details: {} };
}

function err(text: string) {
	return {
		content: [{ type: "text" as const, text: `Error: ${text}` }],
		details: {},
		isError: true,
	};
}
