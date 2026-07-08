import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { MemberState, TeamManagerLike, TeamManagerRef } from "../teams/types-v2.js";

interface TeamToolOptions {
	teamRef: TeamManagerRef;
}

export const CREATE_BATCH_SOFT_LIMIT = 20;
export const ASSIGN_BATCH_SOFT_LIMIT = 20;
export const DIRECT_BATCH_SOFT_LIMIT = 20;

// 核心函数故意不做字段校验：单条 handler 校验（保持字面量），批量靠 TeamManager 抛异常。
// 单条调一次，批量顺序循环调。

type CreateOneResult =
	| { ok: true; state: MemberState; taskId: string | null; taskWarn?: string }
	| { ok: false; error: string };

type AssignResult = { ok: true; taskId: string } | { ok: false; error: string };

type DirectResult = { ok: true } | { ok: false; error: string };

function toErrMsg(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}

async function createOneMember(
	manager: TeamManagerLike,
	spec: {
		name: string;
		role: string;
		goal: string;
		constraints?: string;
		tools?: string[];
		skills?: string[];
		mcps?: string[];
		taskTitle?: string;
		taskDescription?: string;
		taskPriority?: "high" | "medium" | "low";
	},
): Promise<CreateOneResult> {
	let state: MemberState;
	try {
		state = await manager.createMember({
			name: spec.name,
			role: spec.role,
			goal: spec.goal,
			constraints: spec.constraints,
			model: undefined,
			services: {} as never,
			parentModel: undefined,
			tools: spec.tools,
			skills: spec.skills,
			mcps: spec.mcps,
		});
	} catch (e) {
		return { ok: false, error: toErrMsg(e) };
	}

	if (!spec.taskTitle) {
		return { ok: true, state, taskId: null };
	}

	try {
		const task = manager.assignTask({
			title: spec.taskTitle,
			description: spec.taskDescription ?? "",
			memberName: spec.name,
			priority: spec.taskPriority ?? "medium",
		});
		return { ok: true, state, taskId: task.id };
	} catch (e) {
		return { ok: true, state, taskId: null, taskWarn: toErrMsg(e) };
	}
}

function assignOneTask(
	manager: TeamManagerLike,
	spec: {
		name: string;
		title: string;
		description?: string;
		priority?: "high" | "medium" | "low";
	},
): AssignResult {
	try {
		const task = manager.assignTask({
			title: spec.title,
			description: spec.description ?? "",
			memberName: spec.name,
			priority: spec.priority ?? "medium",
		});
		return { ok: true, taskId: task.id };
	} catch (e) {
		return { ok: false, error: toErrMsg(e) };
	}
}

function directOneMessage(
	manager: TeamManagerLike,
	spec: {
		name: string;
		kind: "directive" | "context" | "redirect";
		payload: string;
	},
): DirectResult {
	try {
		manager.directMember(spec.name, spec.kind, spec.payload);
		return { ok: true };
	} catch (e) {
		return { ok: false, error: toErrMsg(e) };
	}
}

const ActionSchema = Type.Union(
	[
		Type.Literal("read"),
		Type.Literal("create"),
		Type.Literal("create-batch"),
		Type.Literal("assign"),
		Type.Literal("assign-batch"),
		Type.Literal("direct"),
		Type.Literal("direct-batch"),
		Type.Literal("edit-member"),
		Type.Literal("complete"),
		Type.Literal("remove"),
		Type.Literal("wait"),
	],
	{ description: "Action to perform on the team" },
);

const BatchMemberSchema = Type.Object({
	name: Type.String({ description: "Member name" }),
	role: Type.String({ description: "Member role" }),
	goal: Type.String({ description: "Member goal" }),
	constraints: Type.Optional(
		Type.String({
			description:
				'Role-specific behavioral constraints (max 800 chars, injected into Anti-Patterns). Example for reviewer: "must run tests, no rubber-stamping"',
		}),
	),
	tools: Type.Optional(Type.Array(Type.String(), { description: "Tool whitelist" })),
	skills: Type.Optional(Type.Array(Type.String(), { description: "Skill names to load" })),
	mcps: Type.Optional(Type.Array(Type.String(), { description: "MCP server names allowed" })),
	taskTitle: Type.Optional(
		Type.String({ description: "Optional first task title — member starts working immediately" }),
	),
	taskDescription: Type.Optional(Type.String({ description: "Optional first task description" })),
	taskPriority: Type.Optional(
		Type.Union([Type.Literal("high"), Type.Literal("medium"), Type.Literal("low")]),
	),
});

const TeamParamsSchema = Type.Object({
	action: ActionSchema,
	name: Type.Optional(
		Type.String({ description: "Member name (for create/assign/direct/edit-member/remove)" }),
	),
	role: Type.Optional(Type.String({ description: "Member role (for create)" })),
	goal: Type.Optional(Type.String({ description: "Member goal (for create)" })),
	constraints: Type.Optional(
		Type.String({
			description:
				'Role-specific behavioral constraints for the member (max 800 chars). Injected into the member\'s Anti-Patterns section. Example for reviewer: "must run tests, no rubber-stamping"',
		}),
	),
	tools: Type.Optional(
		Type.Array(Type.String(), {
			description:
				'Tool whitelist for the member. Defaults to ["read","bash","grep","find","memory","message"]. Subagent/team/question are always stripped (recursive/privilege/blocking risk); memory and message are always included (coordination channel).',
		}),
	),
	skills: Type.Optional(
		Type.Array(Type.String(), {
			description:
				"Skill names to load for this member (must be discoverable skills). Empty = no skills.",
		}),
	),
	mcps: Type.Optional(
		Type.Array(Type.String(), {
			description:
				"MCP server names this member may call (must be connected servers). Empty = no MCP access.",
		}),
	),
	members: Type.Optional(
		Type.Array(BatchMemberSchema, {
			description: "Array of members to create in one call (for create-batch). Soft limit: 20.",
		}),
	),
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
	tasks: Type.Optional(
		Type.Array(
			Type.Object({
				name: Type.String({ description: "Member name to assign the task to" }),
				title: Type.String({ description: "Task title" }),
				description: Type.Optional(Type.String({ description: "Task description" })),
				priority: Type.Optional(
					Type.Union([Type.Literal("high"), Type.Literal("medium"), Type.Literal("low")]),
				),
			}),
			{
				description:
					"Array of tasks to assign in one call (for assign-batch). Each item: {name, title, description?, priority?}. Soft limit: 20.",
			},
		),
	),
	taskId: Type.Optional(Type.String({ description: "Task ID (for complete)" })),
	kind: Type.Optional(
		Type.Union([Type.Literal("directive"), Type.Literal("context"), Type.Literal("redirect")]),
	),
	payload: Type.Optional(Type.String({ description: "Message content (for direct)" })),
	messages: Type.Optional(
		Type.Array(
			Type.Object({
				name: Type.String({ description: "Member name to send the message to" }),
				kind: Type.Union([
					Type.Literal("directive"),
					Type.Literal("context"),
					Type.Literal("redirect"),
				]),
				payload: Type.String({ description: "Message content" }),
			}),
			{
				description:
					"Array of messages to send in one call (for direct-batch). Each item: {name, kind, payload}. Applied in array order; multiple redirects to the same member are applied sequentially (last one wins). Soft limit: 20.",
			},
		),
	),
	section: Type.Optional(Type.Union([Type.Literal("goal"), Type.Literal("active-context")])),
	content: Type.Optional(Type.String({ description: "New content (for edit-member)" })),
	duration: Type.Optional(
		Type.Integer({
			description: "Wait duration in seconds (for wait). Default 30, max 300.",
			minimum: 5,
			maximum: 300,
		}),
	),
});

export function createTeamTool(opts: TeamToolOptions): ToolDefinition {
	return {
		name: "team",
		label: "Team",
		description:
			"Manage your team. Actions:\n" +
			"- read: See who's on the team, what they're working on, current tasks.\n" +
			"- create: Add a member. Give them a name, role, and goal. Optionally include taskTitle + taskDescription to start them working right away.\n" +
			"  Optionally specify tools, skills, mcps to control what the member can do (defaults to a baseline toolset).\n" +
			'  Example: team(action="create", name="sasha", role="frontend dev", goal="Build the login page", constraints="must pass lint and biome checks", taskTitle="Login page", taskDescription="Create Login.tsx with email+password form")\n' +
			'  Example with custom tools: team(action="create", name="marcus", role="backend", goal="Build the API", tools=["read","bash","edit","write","grep","find"], skills=["backend-conventions"], mcps=["postgres"])\n' +
			"- create-batch: Add multiple members in one call. Provide a `members` array; each item has name/role/goal plus optional constraints/taskTitle/taskDescription/taskPriority/tools/skills/mcps. Capacity is checked up-front (current + batch size must fit maxWorkers); per-member failures are isolated (succeeded/failed reported separately).\n" +
			'  Example: team(action="create-batch", members=[{name="alice",role="frontend",goal="UI",constraints="must pass lint",taskTitle="Login",taskDescription="..."},{name="bob",role="backend",goal="API",tools=["read","bash","edit"]])\n' +
			"- assign: Give a task to an idle member. They'll start working on it.\n" +
			'  Example: team(action="assign", name="sasha", title="Add validation", description="Validate email format before submit")\n' +
			"- assign-batch: Assign tasks to multiple members in one call. Provide a `tasks` array; each item has {name, title} plus optional description/priority. Per-task failures (member not found, member not idle) are isolated and reported separately.\n" +
			'  Example: team(action="assign-batch", tasks=[{name="sasha",title="Login validation"},{name="marcus",title="API schema",priority="high"}])\n' +
			'- direct: Send a message to a member mid-task. kind="directive" (change approach), "context" (extra info), "redirect" (new priority).\n' +
			'  Example: team(action="direct", name="sasha", kind="context", payload="The design file is at /docs/mockup.fig")\n' +
			"- direct-batch: Send messages to multiple members in one call. Provide a `messages` array; each item has {name, kind, payload}. Messages are applied in array order; multiple redirects to the same member are applied sequentially (the last redirect wins). Per-message failures (member not found, member not active) are isolated.\n" +
			'  Example: team(action="direct-batch", messages=[{name="sasha",kind="context",payload="design at /docs/m.fig"},{name="marcus",kind="directive",payload="use JWT auth"}])\n' +
			"- edit-member: Update a member's goal or active-context.\n" +
			"- complete: Mark a task as done by its ID.\n" +
			"- remove: Remove a member from the team. Only use this when the user explicitly asks to remove someone — finished members stay idle and available for new tasks.\n" +
			"- wait: Block for N seconds (default 30, max 300), then resume to check team status. Use this instead of repeatedly calling read while members work. The agent loop is suspended during the wait.\n" +
			'  Example: team(action="wait", duration=60)',
		parameters: TeamParamsSchema,
		async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
			const manager = opts.teamRef.current;
			if (!manager) return err("Team manager not available yet — try again in a moment.");
			const args = params as {
				action: string;
				name?: string;
				role?: string;
				goal?: string;
				constraints?: string;
				members?: Array<{
					name: string;
					role: string;
					goal: string;
					constraints?: string;
					tools?: string[];
					skills?: string[];
					mcps?: string[];
					taskTitle?: string;
					taskDescription?: string;
					taskPriority?: "high" | "medium" | "low";
				}>;
				taskTitle?: string;
				taskDescription?: string;
				taskPriority?: string;
				title?: string;
				description?: string;
				priority?: string;
				tasks?: Array<{
					name: string;
					title: string;
					description?: string;
					priority?: "high" | "medium" | "low";
				}>;
				taskId?: string;
				kind?: string;
				payload?: string;
				messages?: Array<{
					name: string;
					kind: "directive" | "context" | "redirect";
					payload: string;
				}>;
				section?: string;
				content?: string;
				tools?: string[];
				skills?: string[];
				mcps?: string[];
				duration?: number;
			};
			try {
				switch (args.action) {
					case "read":
						return handleRead(manager);
					case "create":
						return await handleCreate(manager, args);
					case "create-batch":
						return await handleCreateBatch(manager, args);
					case "assign":
						return handleAssign(manager, args);
					case "assign-batch":
						return handleAssignBatch(manager, args);
					case "direct":
						return handleDirect(manager, args);
					case "direct-batch":
						return handleDirectBatch(manager, args);
					case "edit-member":
						return handleEditMember(manager, args);
					case "complete":
						return handleComplete(manager, args);
					case "remove":
						return await handleRemove(manager, args);
					case "wait":
						return await handleWait(args, signal);
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

	const result = await createOneMember(manager, {
		name,
		role,
		goal,
		constraints: args.constraints as string | undefined,
		tools: args.tools as string[] | undefined,
		skills: args.skills as string[] | undefined,
		mcps: args.mcps as string[] | undefined,
		taskTitle: args.taskTitle as string | undefined,
		taskDescription: args.taskDescription as string | undefined,
		taskPriority: args.taskPriority as "high" | "medium" | "low" | undefined,
	});

	if (!result.ok) return err(result.error);
	if (result.taskWarn) return err(result.taskWarn);

	const taskTitle = args.taskTitle as string | undefined;
	if (taskTitle) {
		return ok(
			`Member "${name}" (${role}) created and working on "${taskTitle}" [${result.taskId}]. Status: active`,
		);
	}

	const tools = args.tools as string[] | undefined;
	const skills = args.skills as string[] | undefined;
	const mcps = args.mcps as string[] | undefined;
	const toolSummary = [
		tools && `tools=[${tools.join(",")}`,
		skills && `skills=[${skills.join(",")}`,
		mcps && `mcps=[${mcps.join(",")}`,
	]
		.filter(Boolean)
		.join(" | ");
	return ok(
		`Member "${name}" (${role}) created. Status: ${result.state.status}${toolSummary ? `. ${toolSummary}` : ""}`,
	);
}

type BatchMember = {
	name: string;
	role: string;
	goal: string;
	constraints?: string;
	taskTitle?: string;
	taskDescription?: string;
	taskPriority?: "high" | "medium" | "low";
	tools?: string[];
	skills?: string[];
	mcps?: string[];
};

type BatchSuccess = {
	name: string;
	role: string;
	taskId: string | null;
	taskWarn?: string;
};

type BatchFailure = {
	name: string;
	error: string;
};

async function handleCreateBatch(manager: TeamManagerLike, args: Record<string, unknown>) {
	const members = args.members as BatchMember[] | undefined;
	if (!members || members.length === 0) {
		return err("members array is required and must not be empty");
	}
	if (members.length > CREATE_BATCH_SOFT_LIMIT) {
		return err(
			`members array length ${members.length} exceeds soft limit ${CREATE_BATCH_SOFT_LIMIT}; split into multiple calls`,
		);
	}

	const currentCount = manager.listMembers().length;
	const maxWorkers = manager.getMaxWorkers();
	if (currentCount + members.length > maxWorkers) {
		return err(
			`Batch rejected: capacity exceeded.\n  Current members: ${currentCount}\n  Batch size: ${members.length}\n  maxWorkers: ${maxWorkers}\n  Remove existing members first or reduce batch size.`,
		);
	}

	const succeeded: BatchSuccess[] = [];
	const failed: BatchFailure[] = [];

	for (const m of members) {
		const result = await createOneMember(manager, m);
		if (!result.ok) {
			failed.push({ name: m.name, error: result.error });
			continue;
		}
		if (result.taskWarn) {
			succeeded.push({ name: m.name, role: m.role, taskId: null, taskWarn: result.taskWarn });
			continue;
		}
		succeeded.push({ name: m.name, role: m.role, taskId: result.taskId });
	}

	const lines: string[] = [];
	lines.push(`Created ${succeeded.length} member(s):`);
	for (const s of succeeded) {
		if (s.taskWarn) {
			lines.push(`  ✓ ${s.name} (${s.role}) — task error: ${s.taskWarn}`);
		} else if (s.taskId) {
			lines.push(`  ✓ ${s.name} (${s.role}) [${s.taskId}]`);
		} else {
			lines.push(`  ✓ ${s.name} (${s.role}) — no task`);
		}
	}
	if (failed.length > 0) {
		lines.push("");
		lines.push(`Failed ${failed.length} member(s):`);
		for (const f of failed) {
			lines.push(`  ✗ ${f.name}: ${f.error}`);
		}
	}

	const isError = succeeded.length === 0;
	const text = lines.join("\n");
	return {
		content: [{ type: "text" as const, text: isError ? `Error: ${text}` : text }],
		details: {},
		isError,
	};
}

function handleAssign(manager: TeamManagerLike, args: Record<string, unknown>) {
	const name = args.name as string | undefined;
	const title = args.title as string | undefined;
	if (!name) return err("name (member) is required for assign");
	if (!title) return err("title is required for assign");
	const result = assignOneTask(manager, {
		name,
		title,
		description: args.description as string | undefined,
		priority: args.priority as "high" | "medium" | "low" | undefined,
	});
	if (!result.ok) return err(result.error);
	return ok(`Task ${result.taskId} "${title}" assigned to @${name}. Member is now active.`);
}

function handleAssignBatch(manager: TeamManagerLike, args: Record<string, unknown>) {
	const tasks = args.tasks as
		| Array<{
				name: string;
				title: string;
				description?: string;
				priority?: "high" | "medium" | "low";
		  }>
		| undefined;
	if (!tasks || tasks.length === 0) {
		return err("tasks array is required and must not be empty");
	}
	if (tasks.length > ASSIGN_BATCH_SOFT_LIMIT) {
		return err(
			`tasks array length ${tasks.length} exceeds soft limit ${ASSIGN_BATCH_SOFT_LIMIT}; split into multiple calls`,
		);
	}

	const succeeded: Array<{ name: string; taskId: string; title: string }> = [];
	const failed: BatchFailure[] = [];

	for (const t of tasks) {
		const result = assignOneTask(manager, t);
		if (!result.ok) {
			failed.push({ name: t.name, error: result.error });
			continue;
		}
		succeeded.push({ name: t.name, taskId: result.taskId, title: t.title });
	}

	const lines: string[] = [];
	lines.push(`Assigned ${succeeded.length} task(s):`);
	for (const s of succeeded) {
		lines.push(`  ✓ ${s.taskId} "${s.title}" → @${s.name}`);
	}
	if (failed.length > 0) {
		lines.push("");
		lines.push(`Failed ${failed.length} task(s):`);
		for (const f of failed) {
			lines.push(`  ✗ @${f.name}: ${f.error}`);
		}
	}

	const isError = succeeded.length === 0;
	const text = lines.join("\n");
	return {
		content: [{ type: "text" as const, text: isError ? `Error: ${text}` : text }],
		details: {},
		isError,
	};
}

function handleDirect(manager: TeamManagerLike, args: Record<string, unknown>) {
	const name = args.name as string | undefined;
	const kind = args.kind as "directive" | "context" | "redirect" | undefined;
	const payload = args.payload as string | undefined;
	if (!name) return err("name is required for direct");
	if (!kind) return err("kind is required for direct");
	if (!payload) return err("payload is required for direct");
	const result = directOneMessage(manager, { name, kind, payload });
	if (!result.ok) return err(result.error);
	return ok(`Message sent to ${name} [${kind}].`);
}

function handleDirectBatch(manager: TeamManagerLike, args: Record<string, unknown>) {
	const messages = args.messages as
		| Array<{
				name: string;
				kind: "directive" | "context" | "redirect";
				payload: string;
		  }>
		| undefined;
	if (!messages || messages.length === 0) {
		return err("messages array is required and must not be empty");
	}
	if (messages.length > DIRECT_BATCH_SOFT_LIMIT) {
		return err(
			`messages array length ${messages.length} exceeds soft limit ${DIRECT_BATCH_SOFT_LIMIT}; split into multiple calls`,
		);
	}

	const succeeded: Array<{ name: string; kind: string; payload: string }> = [];
	const failed: BatchFailure[] = [];

	for (const m of messages) {
		const result = directOneMessage(manager, m);
		if (!result.ok) {
			failed.push({ name: m.name, error: result.error });
			continue;
		}
		succeeded.push({ name: m.name, kind: m.kind, payload: m.payload });
	}

	const lines: string[] = [];
	lines.push(`Sent ${succeeded.length} message(s):`);
	for (const s of succeeded) {
		const truncated = s.payload.length > 60 ? `${s.payload.slice(0, 60)}…` : s.payload;
		lines.push(`  ✓ @${s.name} [${s.kind}]: ${truncated}`);
	}
	if (failed.length > 0) {
		lines.push("");
		lines.push(`Failed ${failed.length} message(s):`);
		for (const f of failed) {
			lines.push(`  ✗ @${f.name}: ${f.error}`);
		}
	}

	const isError = succeeded.length === 0;
	const text = lines.join("\n");
	return {
		content: [{ type: "text" as const, text: isError ? `Error: ${text}` : text }],
		details: {},
		isError,
	};
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

async function handleWait(args: { duration?: number }, signal: AbortSignal | undefined) {
	const seconds = Math.max(5, Math.min(300, args.duration ?? 30));
	await new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => resolve(), seconds * 1000);
		if (signal) {
			signal.addEventListener(
				"abort",
				() => {
					clearTimeout(timer);
					reject(signal.reason ?? new Error("Aborted"));
				},
				{ once: true },
			);
		}
	});
	return ok(`Waited ${seconds}s. Checking team status now.`);
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
