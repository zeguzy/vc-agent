import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type {
	GoalPriority,
	GoalStatus,
	TeamManagerLike,
	TeamManagerRef,
} from "../teams/types-v2.js";

interface TeamToolOptions {
	teamRef: TeamManagerRef;
}

export const CREATE_BATCH_SOFT_LIMIT = 20;
export const ASSIGN_BATCH_SOFT_LIMIT = 20;
export const DIRECT_BATCH_SOFT_LIMIT = 20;

const ActionSchema = Type.Union(
	[
		Type.Literal("read"),
		Type.Literal("create"),
		Type.Literal("create-batch"),
		Type.Literal("assign"),
		Type.Literal("assign-batch"),
		Type.Literal("start-discussion"),
		Type.Literal("direct"),
		Type.Literal("direct-batch"),
		Type.Literal("edit-member"),
		Type.Literal("complete"),
		Type.Literal("remove"),
		Type.Literal("wait"),
		Type.Literal("goal-create"),
		Type.Literal("goal-list"),
		Type.Literal("goal-update"),
		Type.Literal("goal-decompose"),
		Type.Literal("request-task"),
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
	taskType: Type.Optional(
		Type.Union([Type.Literal("execution"), Type.Literal("discussion")], {
			description:
				'Task type for the initial task (for create). "execution" = member works independently (default). "discussion" = multi-member discussion with supervisor coordination.',
		}),
	),
	title: Type.Optional(Type.String({ description: "Task title (for assign)" })),
	description: Type.Optional(Type.String({ description: "Task description (for assign)" })),
	priority: Type.Optional(
		Type.Union([Type.Literal("high"), Type.Literal("medium"), Type.Literal("low")]),
	),
	type: Type.Optional(
		Type.Union([Type.Literal("execution"), Type.Literal("discussion")], {
			description:
				'Task type (for assign/assign-batch). "execution" = member works independently (default). "discussion" = multi-member discussion with supervisor coordination.',
		}),
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
				type: Type.Optional(
					Type.Union([Type.Literal("execution"), Type.Literal("discussion")], {
						description: 'Task type. "execution" (default) or "discussion".',
					}),
				),
			}),
			{
				description:
					"Array of tasks to assign in one call (for assign-batch). Each item: {name, title, description?, priority?, type?}. Soft limit: 20.",
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
	participants: Type.Optional(
		Type.Array(Type.String(), {
			description:
				"Member names for the discussion (for start-discussion). All members must exist and be active/idle. The first member speaks first.",
		}),
	),
	duration: Type.Optional(
		Type.Integer({
			description: "Wait duration in seconds (for wait). Default 30, max 300.",
			minimum: 5,
			maximum: 300,
		}),
	),
	goalId: Type.Optional(Type.String({ description: "Goal ID (for goal-update, goal-decompose)" })),
	parentGoalId: Type.Optional(
		Type.String({ description: "Parent goal ID (for goal-create, to create a sub-goal)" }),
	),
	successCriteria: Type.Optional(
		Type.String({ description: "Success criteria (for goal-create, goal-update)" }),
	),
	blockers: Type.Optional(
		Type.String({ description: "Blocker description (for goal-update when status=blocked)" }),
	),
	goalStatus: Type.Optional(
		Type.Union(
			[
				Type.Literal("pending"),
				Type.Literal("in_progress"),
				Type.Literal("completed"),
				Type.Literal("blocked"),
				Type.Literal("cancelled"),
			],
			{ description: "Goal status (for goal-update)" },
		),
	),
	subGoals: Type.Optional(
		Type.Array(
			Type.Object({
				title: Type.String({ description: "Sub-goal title" }),
				description: Type.String({ description: "Sub-goal description" }),
				successCriteria: Type.Optional(Type.String({ description: "Success criteria" })),
				priority: Type.Optional(
					Type.Union([Type.Literal("high"), Type.Literal("medium"), Type.Literal("low")]),
				),
			}),
			{ description: "Sub-goals to create (for goal-decompose)" },
		),
	),
	capabilities: Type.Optional(
		Type.Array(Type.String(), {
			description: "Member capabilities/skills (for request-task). Helps Leader match tasks.",
		}),
	),
});

export function createTeamTool(opts: TeamToolOptions): ToolDefinition {
	return {
		name: "team",
		label: "Team",
		description:
			"IMPORTANT: New members are read-only by default (read, bash, grep, find, memory, message).\n" +
			'To let a member edit code, you MUST specify tools, e.g. tools=["read","bash","edit","write","grep","find"].\n' +
			"Optionally specify skills to load relevant instructions for the member.\n" +
			"\n" +
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
			"- start-discussion: Start a multi-member discussion task. Provide title, description, and participants (array of member names). A Discussion Supervisor coordinates turns, tracks agenda, and detects off-topic contributions. The first participant speaks first.\n" +
			'  Example: team(action="start-discussion", title="API design review", description="Review the REST API schema for consistency", participants=["sasha","marcus","chen"])\n' +
			'- direct: Send a message to a member mid-task. kind="directive" (change approach), "context" (extra info), "redirect" (new priority).\n' +
			'  Example: team(action="direct", name="sasha", kind="context", payload="The design file is at /docs/mockup.fig")\n' +
			"- direct-batch: Send messages to multiple members in one call. Provide a `messages` array; each item has {name, kind, payload}. Messages are applied in array order; multiple redirects to the same member are applied sequentially (the last redirect wins). Per-message failures (member not found, member not active) are isolated.\n" +
			'  Example: team(action="direct-batch", messages=[{name="sasha",kind="context",payload="design at /docs/m.fig"},{name="marcus",kind="directive",payload="use JWT auth"}])\n' +
			"- edit-member: Update a member's goal or active-context.\n" +
			"- complete: Mark a task as done by its ID.\n" +
			"- remove: Remove a member from the team. Only use this when the user explicitly asks to remove someone — finished members stay idle and available for new tasks.\n" +
			"- wait: Block for N seconds (default 30, max 300). Use sparingly — prefer waiting for system notifications rather than polling. Only use when you need to pause before a deliberate follow-up action. The agent loop is suspended during the wait.\n" +
			'  Example: team(action="wait", duration=60)\n' +
			"- goal-create: Create a new goal. Goals are the team's objective tracking system — decompose them into sub-goals and link tasks.\n" +
			'  Example: team(action="goal-create", title="Ship v1.0", description="Release the first version", priority="high", successCriteria="All features tested and deployed")\n' +
			"- goal-list: List goals, optionally filtered by status/assignee/parent.\n" +
			'  Example: team(action="goal-list") — all goals\n' +
			'  Example: team(action="goal-list", goalStatus="in_progress") — only in-progress\n' +
			"- goal-update: Update a goal's status, priority, assignee, or other fields.\n" +
			'  Example: team(action="goal-update", goalId="G1", goalStatus="completed")\n' +
			'  Example: team(action="goal-update", goalId="G2", goalStatus="blocked", blockers="Waiting for API spec")\n' +
			"- goal-decompose: Break a goal into sub-goals. Automatically sets parent to in_progress.\n" +
			'  Example: team(action="goal-decompose", goalId="G1", subGoals=[{title="Design API",description="REST endpoints"},{title="Implement",description="Backend logic"}])\n' +
			"- request-task: (For members) Request a task from the Leader's goal backlog. Returns a task or 'no tasks available'.\n" +
			'  Example: team(action="request-task", name="sasha", capabilities=["frontend","react"])',
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
				participants?: string[];
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
				goalId?: string;
				parentGoalId?: string;
				successCriteria?: string;
				blockers?: string;
				goalStatus?: "pending" | "in_progress" | "completed" | "blocked" | "cancelled";
				subGoals?: Array<{
					title: string;
					description: string;
					successCriteria?: string;
					priority?: "high" | "medium" | "low";
				}>;
				capabilities?: string[];
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
					case "start-discussion":
						return handleStartDiscussion(manager, args);
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
						return handleWait(args, manager);
					case "goal-create":
						return handleGoalCreate(manager, args);
					case "goal-list":
						return handleGoalList(manager, args);
					case "goal-update":
						return handleGoalUpdate(manager, args);
					case "goal-decompose":
						return handleGoalDecompose(manager, args);
					case "request-task":
						return handleRequestTask(manager, args);
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
	if (teamMd.mission?.trim()) lines.push(`Mission: ${teamMd.mission.trim()}`);

	if (manager.isWaiting()) {
		const remaining = manager.getWaitRemaining();
		lines.push(`⏳ Waiting: ${remaining}s remaining`);
	}

	if (teamMd.goals.length > 0) {
		lines.push("Goals:");
		const byParent = new Map<string | null, typeof teamMd.goals>();
		for (const g of teamMd.goals) {
			const k = g.parentGoalId;
			if (!byParent.has(k)) byParent.set(k, []);
			byParent.get(k)!.push(g);
		}
		function renderGoals(parentId: string | null, depth: number): void {
			const children = byParent.get(parentId) ?? [];
			for (const g of children) {
				const indent = "  ".repeat(depth + 1);
				const statusIcon =
					g.status === "completed"
						? "✓"
						: g.status === "in_progress"
							? "→"
							: g.status === "blocked"
								? "⊘"
								: g.status === "cancelled"
									? "✗"
									: "○";
				const assignee = g.assignee ? ` @${g.assignee}` : "";
				const tasks = g.taskIds.length > 0 ? ` → ${g.taskIds.join(",")}` : "";
				lines.push(`${indent}${statusIcon} ${g.id} [${g.priority}] ${g.title}${assignee}${tasks}`);
				renderGoals(g.id, depth + 1);
			}
		}
		renderGoals(null, 0);
	}

	if (teamMd.members.length > 0) {
		lines.push("Members:");
		for (const m of teamMd.members) {
			const parts = [`${m.name} (${m.role})`, m.status];
			if (m.currentTask) parts.push(m.currentTask);
			lines.push(`  ${parts.join(" · ")}`);
		}
	}
	if (teamMd.activeTasks.length > 0) {
		lines.push("Active Tasks:");
		for (const t of teamMd.activeTasks) {
			const check = t.done ? "✓" : "○";
			const assignee = t.memberName ? `@${t.memberName}` : "unassigned";
			lines.push(`  ${check} ${t.id}: ${t.title} → ${assignee}`);
		}
	}

	const recentMsgs: Array<{
		from: string;
		to: string;
		content: string;
		timestamp: number;
	}> = [];
	for (const m of teamMd.members) {
		try {
			for (const msg of manager.readInbox(m.name, { limit: 5 })) {
				recentMsgs.push(msg);
			}
		} catch {}
	}
	try {
		for (const msg of manager.readInbox("leader", { limit: 5 })) {
			recentMsgs.push(msg);
		}
	} catch {}
	const seenIds = new Set<string>();
	const uniqueMsgs = recentMsgs
		.filter((m) => {
			const k = `${m.from}-${m.to}-${m.timestamp}`;
			if (seenIds.has(k)) return false;
			seenIds.add(k);
			return true;
		})
		.sort((a, b) => a.timestamp - b.timestamp)
		.slice(-10);
	if (uniqueMsgs.length > 0) {
		lines.push("Recent Messages:");
		for (const msg of uniqueMsgs) {
			const fromTag = msg.from === "leader" ? "Leader" : `@${msg.from}`;
			const toTag = msg.to === "broadcast" ? "all" : `@${msg.to}`;
			const snippet = msg.content.length > 100 ? `${msg.content.slice(0, 100)}...` : msg.content;
			const time = new Date(msg.timestamp).toISOString().slice(11, 19);
			lines.push(`  [${time}] ${fromTag} → ${toTag}: ${snippet}`);
		}
	}

	if (teamMd.importantNotes?.trim()) {
		lines.push(`Important: ${teamMd.importantNotes.trim()}`);
	}
	if (teamMd.sharedMemoryIndex.length > 0) {
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

	const tools = args.tools as string[] | undefined;
	const skills = args.skills as string[] | undefined;
	const mcps = args.mcps as string[] | undefined;

	const state = await manager.createMember({
		name,
		role,
		goal,
		constraints: args.constraints as string | undefined,
		model: undefined,
		services: {} as never,
		parentModel: undefined,
		...(tools ? { tools } : {}),
		...(skills ? { skills } : {}),
		...(mcps ? { mcps } : {}),
	});

	const taskTitle = args.taskTitle as string | undefined;
	if (taskTitle) {
		const task = manager.assignTask({
			title: taskTitle,
			description: (args.taskDescription as string) ?? "",
			memberName: name,
			priority: (args.taskPriority as "high" | "medium" | "low" | undefined) ?? "medium",
			type: (args.taskType as "execution" | "discussion" | undefined) ?? "execution",
		});
		return ok(
			`Member "${name}" (${role}) created and working on "${taskTitle}" [${task.id}]. Status: active`,
		);
	}

	const toolSummary = [
		tools && `tools=[${tools.join(",")}`,
		skills && `skills=[${skills.join(",")}`,
		mcps && `mcps=[${mcps.join(",")}`,
	]
		.filter(Boolean)
		.join(" | ");
	return ok(
		`Member "${name}" (${role}) created. Status: ${state.status}${toolSummary ? `. ${toolSummary}` : ""}`,
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
		try {
			await manager.createMember({
				name: m.name,
				role: m.role,
				goal: m.goal,
				constraints: m.constraints,
				model: undefined,
				services: {} as never,
				parentModel: undefined,
				tools: m.tools,
				skills: m.skills,
				mcps: m.mcps,
			});
		} catch (e) {
			failed.push({ name: m.name, error: e instanceof Error ? e.message : String(e) });
			continue;
		}

		if (!m.taskTitle) {
			succeeded.push({ name: m.name, role: m.role, taskId: null });
			continue;
		}

		try {
			const task = manager.assignTask({
				title: m.taskTitle,
				description: m.taskDescription ?? "",
				memberName: m.name,
				priority: m.taskPriority ?? "medium",
			});
			succeeded.push({ name: m.name, role: m.role, taskId: task.id });
		} catch (e) {
			succeeded.push({
				name: m.name,
				role: m.role,
				taskId: null,
				taskWarn: e instanceof Error ? e.message : String(e),
			});
		}
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
	const task = manager.assignTask({
		title,
		description: (args.description as string) ?? "",
		memberName: name,
		priority: (args.priority as "high" | "medium" | "low" | undefined) ?? "medium",
		type: (args.type as "execution" | "discussion" | undefined) ?? "execution",
	});
	return ok(`Task ${task.id} "${title}" assigned to @${name}. Member is now active.`);
}

function handleStartDiscussion(manager: TeamManagerLike, args: Record<string, unknown>) {
	const title = args.title as string | undefined;
	const participants = args.participants as string[] | undefined;
	if (!title) return err("title is required for start-discussion");
	if (!participants || participants.length < 2) {
		return err("participants is required for start-discussion and must have at least 2 members");
	}
	const task = manager.startDiscussion({
		title,
		description: (args.description as string) ?? "",
		participants,
		priority: (args.priority as "high" | "medium" | "low" | undefined) ?? "medium",
	});
	return ok(
		`Discussion ${task.id} "${title}" started with participants: ${participants.map((p) => `@${p}`).join(", ")}. Supervisor will coordinate turns.`,
	);
}

function handleAssignBatch(manager: TeamManagerLike, args: Record<string, unknown>) {
	const tasks = args.tasks as
		| Array<{
				name: string;
				title: string;
				description?: string;
				priority?: "high" | "medium" | "low";
				type?: "execution" | "discussion";
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
		try {
			const task = manager.assignTask({
				title: t.title,
				description: t.description ?? "",
				memberName: t.name,
				priority: t.priority ?? "medium",
				type: t.type ?? "execution",
			});
			succeeded.push({ name: t.name, taskId: task.id, title: t.title });
		} catch (e) {
			failed.push({ name: t.name, error: e instanceof Error ? e.message : String(e) });
		}
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
	manager.directMember(name, kind, payload);
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
		try {
			manager.directMember(m.name, m.kind, m.payload);
			succeeded.push({ name: m.name, kind: m.kind, payload: m.payload });
		} catch (e) {
			failed.push({ name: m.name, error: e instanceof Error ? e.message : String(e) });
		}
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

function handleWait(args: { duration?: number }, manager: TeamManagerLike) {
	const seconds = Math.max(5, Math.min(300, args.duration ?? 30));
	manager.startWait(seconds);
	return ok(
		`Waiting ${seconds}s in background. You can continue working — I'll be notified when the timer expires. Use team(action="read") to check status anytime.`,
	);
}

function handleGoalCreate(manager: TeamManagerLike, args: Record<string, unknown>) {
	const title = args.title as string | undefined;
	if (!title) return err("title is required for goal-create");
	const goal = manager.createGoal({
		title,
		description: (args.description as string) ?? "",
		priority: (args.priority as "high" | "medium" | "low" | undefined) ?? "medium",
		parentGoalId: args.parentGoalId as string | undefined,
		successCriteria: args.successCriteria as string | undefined,
		assignee: args.name as string | undefined,
	});
	return ok(
		`Goal ${goal.id} "${title}" created${args.parentGoalId ? ` under ${args.parentGoalId}` : ""}.`,
	);
}

function handleGoalList(manager: TeamManagerLike, args: Record<string, unknown>) {
	const goals = manager.listGoals({
		status: args.goalStatus as GoalStatus | undefined,
		parentGoalId: args.parentGoalId as string | null | undefined,
		assignee: args.name as string | undefined,
	});
	if (goals.length === 0) return ok("No goals found.");
	const lines: string[] = ["Goals:"];
	for (const g of goals) {
		const icon =
			g.status === "completed"
				? "✓"
				: g.status === "in_progress"
					? "→"
					: g.status === "blocked"
						? "⊘"
						: g.status === "cancelled"
							? "✗"
							: "○";
		const assignee = g.assignee ? ` @${g.assignee}` : "";
		lines.push(`  ${icon} ${g.id} [${g.priority}] ${g.title}${assignee}`);
		if (g.successCriteria) lines.push(`    Success: ${g.successCriteria}`);
	}
	return ok(lines.join("\n"));
}

function handleGoalUpdate(manager: TeamManagerLike, args: Record<string, unknown>) {
	const goalId = args.goalId as string | undefined;
	if (!goalId) return err("goalId is required for goal-update");
	const goal = manager.updateGoal(goalId, {
		status: args.goalStatus as GoalStatus | undefined,
		priority: args.priority as GoalPriority | undefined,
		title: args.title as string | undefined,
		description: args.description as string | undefined,
		assignee: args.name as string | null | undefined,
		successCriteria: args.successCriteria as string | undefined,
		blockers: args.blockers as string | undefined,
	});
	return ok(`Goal ${goal.id} updated: status=${goal.status}, priority=${goal.priority}.`);
}

function handleGoalDecompose(manager: TeamManagerLike, args: Record<string, unknown>) {
	const goalId = args.goalId as string | undefined;
	if (!goalId) return err("goalId is required for goal-decompose");
	const subGoals = args.subGoals as
		| Array<{
				title: string;
				description: string;
				successCriteria?: string;
				priority?: "high" | "medium" | "low";
		  }>
		| undefined;
	if (!subGoals || subGoals.length === 0) {
		return err("subGoals array is required and must not be empty");
	}
	const created = manager.decomposeGoal(goalId, subGoals);
	return ok(
		`Goal ${goalId} decomposed into ${created.length} sub-goals: ${created.map((g) => g.id).join(", ")}.`,
	);
}

function handleRequestTask(manager: TeamManagerLike, args: Record<string, unknown>) {
	const name = args.name as string | undefined;
	if (!name) return err("name (your member name) is required for request-task");
	const task = manager.requestTask(name, args.capabilities as string[] | undefined);
	if (!task) {
		return ok(
			"No suitable tasks available right now. Check back later or ask the leader directly.",
		);
	}
	return ok(`Task ${task.id} "${task.title}" assigned to you. Get to work!`);
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
