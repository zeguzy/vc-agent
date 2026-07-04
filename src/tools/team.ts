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
	[Type.Literal("spawn"), Type.Literal("poll"), Type.Literal("cancel")],
	{
		description:
			"spawn=fire-and-forget a background worker, poll=check status, cancel=stop workers",
	},
);

const TeamParamsSchema = Type.Object({
	action: ActionSchema,
	agent: Type.Optional(Type.String({ description: "Agent name for spawn action" })),
	task: Type.Optional(Type.String({ description: "Task description for spawn action" })),
	workerId: Type.Optional(Type.String({ description: "Worker id for poll/cancel single worker" })),
	workerIds: Type.Optional(
		Type.Array(Type.String(), { description: "Worker ids for poll (check specific workers)" }),
	),
	wait: Type.Optional(
		Type.Boolean({ description: "For poll: wait until workers finish (default false, max 60s)" }),
	),
	full: Type.Optional(
		Type.Boolean({
			description: "For poll: return full summary text instead of truncated (default 1KB)",
		}),
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
		.filter((a) => a.background !== false)
		.map((a) => `'${a.name}' — ${a.description.split("\n")[0]}`)
		.join(" ");

	const DESCRIPTION = [
		"Spawn background workers for parallel task execution. Workers run asynchronously — spawn one or more, then poll for results later.",
		`Available agents: ${agentTable || "(none — create .openagent/agents/*.md files with background:true)"}.`,
		"",
		"spawn: Fire-and-forget a worker. Returns workerId immediately. Worker runs with limited tools (read/grep/find only — no write/edit unless permissionMode=acceptEdits).",
		"poll: Check worker status. Without wait, returns current snapshot. With wait=true, blocks until workers finish (max 60s).",
		"cancel: Stop running workers. Pass workerId to cancel one, omit to cancel all.",
		"",
		"Typical workflow: spawn 2-3 workers in parallel → continue your work → poll for results → synthesize.",
	].join("\n");

	return {
		name: "team",
		label: "Team",
		description: DESCRIPTION,
		promptSnippet: `team — spawn/poll/cancel background workers (${agentList})`,
		parameters: TeamParamsSchema,
		async execute(_toolCallId, rawParams, _signal) {
			const p = rawParams as {
				action: "spawn" | "poll" | "cancel";
				agent?: string;
				task?: string;
				workerId?: string;
				workerIds?: string[];
				wait?: boolean;
				full?: boolean;
			};

			if (!poolRef.current) {
				return errorResult("teams not initialized yet — try again in a moment");
			}

			const pool = poolRef.current;

			if (p.action === "spawn") {
				if (!p.agent || !p.task) {
					return errorResult("agent and task required for spawn action");
				}

				const { agents } = discoverAgents(options.cwd);
				const agentMap = new Map(agents.map((a) => [a.name, a]));
				const agentConfig = agentMap.get(p.agent);

				if (!agentConfig) {
					return errorResult(
						`agent "${p.agent}" not found. Available: ${formatAgentNames(agents)}`,
					);
				}

				if (agentConfig.background === false) {
					return errorResult(
						`agent "${p.agent}" has background:false — cannot be used as a team worker. Set background:true in frontmatter.`,
					);
				}

				const worker = await pool.spawnWorker({
					agent: agentConfig,
					task: p.task,
					cwd: options.cwd,
					services: options.services,
					parentModel: options.parentModel,
				});

				return textResult(
					`Worker spawned: ${worker.workerId} (${p.agent}) — status: ${worker.status}\nUse team.poll(workerId="${worker.workerId}") to check progress.`,
				);
			}

			if (p.action === "poll") {
				const ids = p.workerIds ?? (p.workerId ? [p.workerId] : undefined);
				let snapshots = ids
					? ids.map((id) => pool.get(id)).filter((s): s is WorkerSnapshot => s !== undefined)
					: pool.list();

				if (snapshots.length === 0) {
					return textResult("No workers found. Use team.spawn() first.");
				}

				if (p.wait) {
					const deadline = Date.now() + MAX_POLL_TIMEOUT_MS;
					const targetIds = new Set(snapshots.map((s) => s.id));

					while (Date.now() < deadline) {
						snapshots = ids
							? ids.map((id) => pool.get(id)).filter((s): s is WorkerSnapshot => s !== undefined)
							: pool.list();

						const filtered = ids ? snapshots : snapshots.filter((s) => targetIds.has(s.id));
						const pending = filtered.filter((s) => s.status === "running" || s.status === "idle");

						if (pending.length === 0) break;

						await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
					}

					const stillRunning = snapshots.filter(
						(s) => s.status === "running" || s.status === "idle",
					);
					if (stillRunning.length > 0) {
						const parts = snapshots.map((s) => formatSnapshot(s, p.full ?? false));
						return textResult(
							`[poll timeout, ${stillRunning.length} workers still running]\n\n${parts.join("\n\n")}`,
						);
					}
				}

				const parts = snapshots.map((s) => formatSnapshot(s, p.full ?? false));
				const running = snapshots.filter(
					(s) => s.status === "running" || s.status === "idle",
				).length;
				const finished = snapshots.length - running;
				const totalCost = snapshots.reduce((acc, s) => acc + s.cost, 0);

				const header = p.wait
					? `All ${snapshots.length} workers finished | total cost $${totalCost.toFixed(4)}`
					: `${finished}/${snapshots.length} workers finished, ${running} running | total cost $${totalCost.toFixed(4)}`;

				return textResult(`${header}\n\n${parts.join("\n\n")}`);
			}

			if (p.workerId) {
				await pool.cancel(p.workerId);
				return textResult(`Worker ${p.workerId} cancelled.`);
			}

			await pool.cancelAll();
			return textResult("All workers cancelled.");
		},
	};
}
