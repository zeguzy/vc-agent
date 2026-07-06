import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { discoverAgents } from "../agents/discover.js";
import { runSubagent } from "../agents/runner.js";
import type {
	AgentConfig,
	SubagentResult,
	SubagentServices,
	SubagentToolDetails,
	SubagentToolParams,
} from "../agents/types.js";
import { MAX_OUTPUT_CHARS, MAX_PARALLEL_TASKS, PARALLEL_CONCURRENCY } from "../agents/types.js";

type ResolvedModel = NonNullable<ReturnType<typeof import("../agent/session.js").resolveModel>>;

interface SubagentToolOptions {
	cwd: string;
	services: SubagentServices;
	parentModel?: ResolvedModel;
}

const SubagentParamsSchema = Type.Object({
	mode: Type.Union([Type.Literal("single"), Type.Literal("parallel"), Type.Literal("chain")], {
		description:
			"single=one agent+task, parallel=concurrent tasks, chain=sequential with {previous} substitution",
	}),
	agent: Type.Optional(Type.String({ description: "Agent name (required for single mode)" })),
	description: Type.Optional(
		Type.String({ description: "Task description (required for single mode)" }),
	),
	tasks: Type.Optional(
		Type.Array(
			Type.Object({
				agent: Type.String({ description: "Agent name" }),
				description: Type.String({ description: "Task description" }),
			}),
			{ description: "Tasks for parallel/chain mode" },
		),
	),
});

async function mapWithConcurrencyLimit<T, R>(
	items: T[],
	limit: number,
	fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
	const results: R[] = new Array(items.length);
	let nextIndex = 0;

	async function worker(): Promise<void> {
		while (nextIndex < items.length) {
			const index = nextIndex++;
			results[index] = await fn(items[index], index);
		}
	}

	const workerCount = Math.min(limit, items.length);
	await Promise.all(Array.from({ length: workerCount }, () => worker()));
	return results;
}

function truncate(text: string, max: number): string {
	if (text.length <= max) return text;
	const half = Math.floor((max - 30) / 2);
	return `${text.slice(0, half)}\n\n... [truncated ${text.length - max + 30} chars] ...\n\n${text.slice(-half)}`;
}

function buildAgentIndex(agents: AgentConfig[]): Map<string, AgentConfig> {
	return new Map(agents.map((a) => [a.name, a]));
}

function formatAgentNames(agents: AgentConfig[]): string {
	return agents.length > 0 ? agents.map((a) => a.name).join(", ") : "(none defined yet)";
}

export function createSubagentTool(options: SubagentToolOptions): ToolDefinition {
	const { cwd, services, parentModel } = options;

	const initialAgents = discoverAgents(cwd).agents;
	const agentList = formatAgentNames(initialAgents);

	const DESCRIPTION = [
		`Delegate tasks to specialized subagents with isolated context windows. Available agents: see system prompt for the full list (${initialAgents.length} total).`,
		"Modes: single (one agent, one task), parallel (multiple tasks concurrently, max 8), chain (sequential, {previous} placeholder).",
		"Each delegation prompt MUST include: specific GOAL, relevant file CONTEXT, and clear SCOPE boundaries.",
		"Vague prompts produce poor results — be exhaustive in your task description.",
	].join(" ");

	const emptyDetails = (mode: string): SubagentToolDetails => ({
		mode: mode as SubagentToolDetails["mode"],
		results: [],
		totalCost: 0,
		totalTurns: 0,
	});

	const errorResult = (msg: string, mode: string) => ({
		content: [{ type: "text" as const, text: `Error: ${msg}` }],
		details: emptyDetails(mode),
	});

	return {
		name: "subagent",
		label: "Subagent",
		description: DESCRIPTION,
		promptSnippet: `subagent — delegate to specialized agents (${agentList})`,
		parameters: SubagentParamsSchema,
		async execute(_toolCallId, rawParams, signal, onUpdate) {
			const p = rawParams as SubagentToolParams;
			const { agents } = discoverAgents(cwd);
			const agentMap = buildAgentIndex(agents);

			if (agents.length === 0) {
				return errorResult(
					"No agents defined. Create .md files with YAML frontmatter in ~/.config/openagent/agents/ or .openagent/agents/",
					p.mode,
				);
			}

			if (p.mode === "single") {
				if (!p.agent || !p.description) {
					return errorResult("agent and description required for single mode", "single");
				}
				const agentConfig = agentMap.get(p.agent);
				if (!agentConfig) {
					return errorResult(
						`agent "${p.agent}" not found. Available: ${formatAgentNames(agents)}`,
						"single",
					);
				}

				const result = await runSubagent({
					agent: agentConfig,
					task: p.description,
					cwd,
					services,
					parentModel,
					signal,
					onUpdate: (text) =>
						onUpdate?.({
							content: [{ type: "text", text }],
							details: emptyDetails("single"),
						}),
				});

				const output = truncate(result.output, MAX_OUTPUT_CHARS);
				return {
					content: [
						{
							type: "text" as const,
							text: `## Subagent: ${result.agent}\n\n${output}${result.error ? `\n\n**Error:** ${result.error}` : ""}`,
						},
					],
					details: {
						mode: "single",
						results: [result],
						totalCost: result.usage?.cost ?? 0,
						totalTurns: result.usage?.turns ?? 0,
					} as SubagentToolDetails,
				};
			}

			if (p.mode === "parallel") {
				const tasks = p.tasks;
				if (!tasks || tasks.length === 0) {
					return errorResult("tasks required for parallel mode", "parallel");
				}
				if (tasks.length > MAX_PARALLEL_TASKS) {
					return errorResult(
						`too many tasks (${tasks.length}). Maximum: ${MAX_PARALLEL_TASKS}`,
						"parallel",
					);
				}
				const invalid = tasks.find((t) => !agentMap.has(t.agent));
				if (invalid) {
					return errorResult(
						`agent "${invalid.agent}" not found. Available: ${formatAgentNames(agents)}`,
						"parallel",
					);
				}

				const results = await mapWithConcurrencyLimit(tasks, PARALLEL_CONCURRENCY, (task) =>
					runSubagent({
						agent: agentMap.get(task.agent) as AgentConfig,
						task: task.description,
						cwd,
						services,
						parentModel,
						signal,
						onUpdate: (text) =>
							onUpdate?.({
								content: [{ type: "text", text: `[${task.agent}] ${text}` }],
								details: emptyDetails("parallel"),
							}),
					}),
				);

				const parts = results.map((r, i) => {
					const text = truncate(r.output, MAX_OUTPUT_CHARS);
					return `### Task ${i + 1}: ${r.description} (${r.agent})\n\n${text}${r.error ? `\n\n**Error:** ${r.error}` : ""}`;
				});
				const totalCost = results.reduce((s, r) => s + (r.usage?.cost ?? 0), 0);
				const totalTurns = results.reduce((s, r) => s + (r.usage?.turns ?? 0), 0);

				return {
					content: [
						{
							type: "text" as const,
							text: `## Subagent Results (${results.length} tasks)\n\n${parts.join("\n\n---\n\n")}`,
						},
					],
					details: { mode: "parallel", results, totalCost, totalTurns } as SubagentToolDetails,
				};
			}

			const tasks = p.tasks;
			if (!tasks || tasks.length === 0) {
				return errorResult("tasks required for chain mode", "chain");
			}
			const invalid = tasks.find((t) => !agentMap.has(t.agent));
			if (invalid) {
				return errorResult(
					`agent "${invalid.agent}" not found. Available: ${formatAgentNames(agents)}`,
					"chain",
				);
			}

			const chainResults: SubagentResult[] = [];
			let previousOutput = "";

			for (let i = 0; i < tasks.length; i++) {
				const task = tasks[i];
				let taskDesc = task.description;
				if (previousOutput) {
					taskDesc = taskDesc.replace(/\{previous\}/g, previousOutput);
				}

				const result = await runSubagent({
					agent: agentMap.get(task.agent) as AgentConfig,
					task: taskDesc,
					cwd,
					services,
					parentModel,
					signal,
					onUpdate: (text) =>
						onUpdate?.({
							content: [
								{
									type: "text",
									text: `[Chain ${i + 1}/${tasks.length}: ${task.agent}] ${text}`,
								},
							],
							details: emptyDetails("chain"),
						}),
				});

				chainResults.push(result);
				if (result.error) break;
				previousOutput = truncate(result.output, MAX_OUTPUT_CHARS);
			}

			const parts = chainResults.map((r, i) => {
				const text = truncate(r.output, MAX_OUTPUT_CHARS);
				return `### Step ${i + 1}: ${r.agent}\n\n${text}${r.error ? `\n\n**Error:** ${r.error}` : ""}`;
			});
			const totalCost = chainResults.reduce((s, r) => s + (r.usage?.cost ?? 0), 0);
			const totalTurns = chainResults.reduce((s, r) => s + (r.usage?.turns ?? 0), 0);

			return {
				content: [
					{
						type: "text" as const,
						text: `## Subagent Chain (${chainResults.length}/${tasks.length} steps)\n\n${parts.join("\n\n---\n\n")}`,
					},
				],
				details: {
					mode: "chain",
					results: chainResults,
					totalCost,
					totalTurns,
				} as SubagentToolDetails,
			};
		},
	};
}
