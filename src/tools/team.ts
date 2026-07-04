import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { discoverAgents } from "../agents/discover.js";
import type { AgentConfig, SubagentServices } from "../agents/types.js";
import type { WorkerPoolRef, WorkerSnapshot } from "../teams/types.js";

const MAX_POLL_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 300;
const DEFAULT_SUMMARY_MAX_CHARS = 1024;

interface TeamToolOptions {
	poolRef: WorkerPoolRef;
	cwd: string;
	services: SubagentServices;
	parentModel?: ReturnType<SubagentServices["modelRegistry"]["getAll"]>[number];
}

const ActionSchema = Type.Union(
	[
		Type.Literal("create-member"),
		Type.Literal("assign-task"),
		Type.Literal("poll"),
		Type.Literal("cancel"),
		Type.Literal("send-message"),
		Type.Literal("list-members"),
		Type.Literal("list-tasks"),
		Type.Literal("task-status"),
		Type.Literal("read-inbox"),
	],
	{
		description:
			"create-member=create team member, assign-task=assign work to member, poll=check member status, cancel=stop member, send-message=inter-member comm, list-members/list-tasks=view status, task-status=task detail, read-inbox=view messages",
	},
);

const TeamParamsSchema = Type.Object({
	action: ActionSchema,
	name: Type.Optional(Type.String({ description: "Member name for create-member" })),
	role: Type.Optional(Type.String({ description: "Member role for create-member" })),
	goal: Type.Optional(Type.String({ description: "Member goal for create-member" })),
	model: Type.Optional(Type.String({ description: "Model for member" })),
	title: Type.Optional(Type.String({ description: "Task title for assign-task" })),
	description: Type.Optional(Type.String({ description: "Task description for assign-task" })),
	memberId: Type.Optional(
		Type.String({ description: "Member ID for poll/cancel/assign-task/send-message" }),
	),
	taskId: Type.Optional(Type.String({ description: "Task ID for task-status" })),
	priority: Type.Optional(
		Type.Union([Type.Literal("high"), Type.Literal("medium"), Type.Literal("low")], {
			description: "Task priority, default medium",
		}),
	),
	content: Type.Optional(Type.String({ description: "Message content for send-message" })),
	to: Type.Optional(Type.String({ description: "Recipient memberId or 'team' for broadcast" })),
	wait: Type.Optional(
		Type.Boolean({ description: "For poll: wait until member finishes (default false, max 60s)" }),
	),
	full: Type.Optional(
		Type.Boolean({ description: "For poll: return full output (default truncated to 2KB)" }),
	),
});

function textResult(text: string) {
	return { content: [{ type: "text" as const, text }], details: {} };
}

function errorResult(text: string) {
	return { content: [{ type: "text" as const, text: `Error: ${text}` }], details: {} };
}

function formatAgentNames(agents: AgentConfig[]): string {
	return agents.length > 0 ? agents.map((a) => a.name).join(", ") : "(none defined yet)";
}

function formatSnapshot(s: WorkerSnapshot, full: boolean): string {
	const summary = s.lastSummary ?? "(no output yet)";
	const truncated = full
		? summary
		: summary.slice(0, DEFAULT_SUMMARY_MAX_CHARS) +
			(summary.length > DEFAULT_SUMMARY_MAX_CHARS ? "…" : "");
	const costStr = s.cost > 0 ? ` | cost $${s.cost.toFixed(4)}` : "";
	return [
		`  [${s.status}] ${s.id} (${s.agent}) turns=${s.turnCount} in=${s.inputTokens} out=${s.outputTokens}${costStr}`,
		s.status === "done" || s.status === "error" ? `    ${truncated.split("\n")[0]}` : "",
		s.status === "error" && s.lastError ? `    error: ${s.lastError}` : "",
	]
		.filter(Boolean)
		.join("\n");
}

export function createTeamTool(options: TeamToolOptions): ToolDefinition {
	const { poolRef } = options;

	const initialAgents = discoverAgents(options.cwd).agents;
	const agentList = formatAgentNames(initialAgents);

	const agentTable = initialAgents
		.map((a) => `'${a.name}' — ${a.description.split("\n")[0]}`)
		.join(" ");

	const DESCRIPTION = [
		"Manage your team — create members, assign tasks, send messages, track progress.",
		`Available agent templates: ${agentTable || "(none — create .openagent/agents/*.md files)"}.`,
		"",
		"create-member: Create a team member with name, role, goal. Returns memberId. Members stay idle until assigned a task.",
		"assign-task: Create a task and assign to a member. Member starts working immediately.",
		"poll: Check member status and output. With wait=true, blocks until member finishes (max 60s).",
		"cancel: Stop a member. Pass memberId to cancel one, omit to cancel all.",
		"send-message: Send a message from one member to another (or broadcast to team).",
		"list-members / list-tasks: View all members and tasks at a glance.",
		"task-status: Get detailed status of a specific task.",
		"read-inbox: Read messages sent between members.",
		"",
		"Workflow: create members → assign tasks → poll for results → send messages for review → synthesize.",
	].join("\n");

	return {
		name: "team",
		label: "Team",
		description: DESCRIPTION,
		promptSnippet: `team — manage team members, tasks, and messages (${agentList})`,
		parameters: TeamParamsSchema,
		async execute(_toolCallId, rawParams, _signal) {
			const p = rawParams as {
				action:
					| "create-member"
					| "assign-task"
					| "poll"
					| "cancel"
					| "send-message"
					| "list-members"
					| "list-tasks"
					| "task-status"
					| "read-inbox";
				name?: string;
				role?: string;
				goal?: string;
				model?: string;
				title?: string;
				description?: string;
				memberId?: string;
				taskId?: string;
				priority?: "high" | "medium" | "low";
				content?: string;
				to?: string;
				wait?: boolean;
				full?: boolean;
			};

			if (!poolRef.current) {
				return errorResult("teams not initialized yet — try again in a moment");
			}

			const pool = poolRef.current;

			if (p.action === "create-member") {
				if (!p.name || !p.role || !p.goal) {
					return errorResult("name, role, and goal required for create-member");
				}
				const member = pool.createMember({
					name: p.name,
					role: p.role,
					goal: p.goal,
					model: p.model,
				});
				return textResult(
					`Member created: ${member.name} (${member.id}) — role: ${member.role}, status: idle\nAssign tasks with team.assign-task.`,
				);
			}

			if (p.action === "assign-task") {
				if (!p.title || !p.description || !p.memberId) {
					return errorResult("title, description, and memberId required for assign-task");
				}
				const task = pool.assignTask({
					title: p.title,
					description: p.description,
					memberId: p.memberId,
					priority: p.priority,
				});
				return textResult(
					`Task assigned: ${task.title} (${task.id}) → member ${p.memberId}\nStatus: ${task.status}, priority: ${task.priority}`,
				);
			}

			if (p.action === "list-members") {
				const members = pool.listMembers();
				if (members.length === 0) return textResult("No members yet. Use create-member first.");
				const lines = members.map(
					(m) =>
						`  [${m.status}] ${m.name} (${m.id.slice(0, 10)}) — ${m.role}: ${m.goal.slice(0, 60)}`,
				);
				return textResult(lines.join("\n"));
			}

			if (p.action === "list-tasks") {
				const tasks = pool.listTasks();
				if (tasks.length === 0) return textResult("No tasks yet. Use assign-task to create.");
				const lines = tasks.map(
					(t) =>
						`  [${t.status}] ${t.title} (${t.id.slice(0, 10)})${t.assignedTo ? ` → ${t.assignedTo.slice(0, 10)}` : ""} · ${t.priority}`,
				);
				return textResult(lines.join("\n"));
			}

			if (p.action === "task-status") {
				if (!p.taskId) return errorResult("taskId required for task-status");
				const task = pool.taskStatus(p.taskId);
				if (!task) return errorResult(`task ${p.taskId} not found`);
				return textResult(
					`Task: ${task.title}\nStatus: ${task.status} | Assigned: ${task.assignedTo ?? "none"} | Priority: ${task.priority}\nDescription: ${task.description}${task.result ? `\nResult: ${task.result.slice(0, 2000)}` : ""}${task.blockReason ? `\nBlocked: ${task.blockReason}` : ""}`,
				);
			}

			if (p.action === "send-message") {
				if (!p.memberId || !p.content) {
					return errorResult("memberId (from) and content required for send-message");
				}
				const recipient = p.to || "team";
				pool.sendMessage(p.memberId, recipient, p.content);
				return textResult(`Message sent: ${p.memberId.slice(0, 10)} → ${recipient}`);
			}

			if (p.action === "read-inbox") {
				const msgs = pool.readInbox(p.memberId);
				if (msgs.length === 0) return textResult("No messages.");
				const lines = msgs
					.slice(-20)
					.map((m) => `  [${m.from.slice(0, 10)} → ${m.to}] ${m.content.slice(0, 100)}`);
				return textResult(`Recent messages (${msgs.length} total):\n${lines.join("\n")}`);
			}

			if (p.action === "poll") {
				const memberId = p.memberId;
				let snapshots = memberId
					? ([pool.get(memberId)].filter(Boolean) as WorkerSnapshot[])
					: pool.list();

				if (snapshots.length === 0) {
					return textResult("No members found. Use create-member first.");
				}

				if (p.wait) {
					const deadline = Date.now() + MAX_POLL_TIMEOUT_MS;
					while (Date.now() < deadline) {
						snapshots = memberId
							? ([pool.get(memberId)].filter(Boolean) as WorkerSnapshot[])
							: pool.list();
						const pending = snapshots.filter((s) => s.status === "running" || s.status === "idle");
						if (pending.length === 0) break;
						await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
					}
				}

				const parts = snapshots.map((s) => formatSnapshot(s, p.full ?? false));
				const running = snapshots.filter(
					(s) => s.status === "running" || s.status === "idle",
				).length;
				const finished = snapshots.length - running;
				const totalCost = snapshots.reduce((acc, s) => acc + s.cost, 0);
				const header = p.wait
					? `All ${snapshots.length} members finished | total cost $${totalCost.toFixed(4)}`
					: `${finished}/${snapshots.length} finished, ${running} running | total cost $${totalCost.toFixed(4)}`;

				return textResult(`${header}\n\n${parts.join("\n\n")}`);
			}

			if (p.memberId) {
				await pool.cancel(p.memberId);
				return textResult(`Member ${p.memberId.slice(0, 10)} cancelled.`);
			}

			await pool.cancelAll();
			return textResult("All members cancelled.");
		},
	};
}
