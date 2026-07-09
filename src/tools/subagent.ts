import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { discoverAgents } from "../agents/discover.js";
import { continueSubagent, runSubagent } from "../agents/runner.js";
import type { TaskRegistry } from "../agents/task-registry.js";
import type {
	AgentConfig,
	SubagentResult,
	SubagentServices,
	SubagentToolDetails,
	SubagentToolParams,
} from "../agents/types.js";
import { MAX_OUTPUT_CHARS, MAX_PARALLEL_TASKS, PARALLEL_CONCURRENCY } from "../agents/types.js";

const PREVIEW_MAX_CHARS = 5000;

type ResolvedModel = NonNullable<ReturnType<typeof import("../agent/session.js").resolveModel>>;

interface SubagentToolOptions {
	cwd: string;
	services: SubagentServices;
	parentModel?: ResolvedModel;
	taskRegistry?: TaskRegistry;
	parentSessionId?: string;
	onBackgroundComplete?: (taskId: string, result: SubagentResult) => void;
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
	prompt: Type.Optional(
		Type.String({
			description:
				"Full detailed prompt for the subagent (supersedes 'description' for task content)",
		}),
	),
	category: Type.Optional(
		Type.String({
			description:
				"Task category: quick/deep/ultrabrain/visual-engineering/artistry/unspecified-high/unspecified-low/writing",
		}),
	),
	subagent_type: Type.Optional(
		Type.String({
			description:
				"Direct agent type: explore/librarian/oracle/metis/momus/codebase-analyzer/codebase-locator/codebase-pattern-finder/thoughts-analyzer/thoughts-locator/web-search-researcher/multimodal-looker",
		}),
	),
	run_in_background: Type.Optional(
		Type.Boolean({
			description: "Run asynchronously, return task ID immediately (default: false)",
		}),
	),
	task_id: Type.Optional(
		Type.String({ description: "Continue an existing subagent session (ses_... format)" }),
	),
	command: Type.Optional(Type.String({ description: "Slash command that triggered this task" })),
	load_skills: Type.Optional(
		Type.Array(Type.String(), { description: "Skill names to inject into subagent session" }),
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

function formatResultMarkdown(result: SubagentResult, mode: string): string {
	const status = result.error ? "failed" : "completed";
	const lines: string[] = [
		`## Subagent Result`,
		``,
		`**Agent**: ${result.agent} | **Status**: ${status} | **Mode**: ${mode}`,
	];
	if (result.category) lines.push(`**Category**: ${result.category}`);
	if (result.sessionId) lines.push(`**Session**: ${result.sessionId}`);
	if (result.backgroundTaskId) lines.push(`**Background Task**: ${result.backgroundTaskId}`);
	if (result.usage) {
		lines.push(
			`**Usage**: ${result.usage.turns} turns | $${result.usage.cost.toFixed(4)} | ${result.usage.inputTokens}in/${result.usage.outputTokens}out`,
		);
	}
	lines.push("", "### Output", "");
	if (result.error) {
		lines.push(`**Error**: ${result.error}`, "");
	}
	const preview = truncate(result.output, PREVIEW_MAX_CHARS);
	lines.push(preview);
	lines.push("");
	lines.push(
		`<task_metadata session_id="${result.sessionId ?? ""}" agent="${result.agent}" category="${result.category ?? ""}" background_task_id="${result.backgroundTaskId ?? ""}" />`,
	);
	return lines.join("\n");
}

export function createSubagentTool(options: SubagentToolOptions): ToolDefinition {
	const { cwd, services, parentModel, taskRegistry, parentSessionId, onBackgroundComplete } =
		options;

	const initialAgents = discoverAgents(cwd).agents;
	const agentList = formatAgentNames(initialAgents);

	const DESCRIPTION = [
		`Delegate tasks to specialized subagents with isolated context windows. Available agents: see system prompt for the full list (${initialAgents.length} total).`,
		"Modes: single (one agent, one task), parallel (multiple tasks concurrently, max 8), chain (sequential, {previous} placeholder).",
		"Each delegation prompt MUST include: specific GOAL, relevant file CONTEXT, and clear SCOPE boundaries.",
		"Vague prompts produce poor results — be exhaustive in your task description.",
		"The result returned by the subagent is not visible to the user. To show the user the result, send a text message summarizing it.",
		"Single mode accepts: 'prompt' (full task text, supersedes 'description'), 'subagent_type' (alias for 'agent'), 'category' (quick/deep/ultrabrain/visual-engineering/artistry/unspecified-high/unspecified-low/writing), 'load_skills' (skill names to inject), 'run_in_background' (async, returns bg_xxx ID), 'task_id' (continue session ses_xxx), 'command' (originating slash command).",
		"Use background_output to fetch results from async tasks, background_cancel to abort them.",
	].join(" ");

	const emptyDetails = (mode: string): SubagentToolDetails => ({
		mode: mode as SubagentToolDetails["mode"],
		results: [],
		totalCost: 0,
		totalTurns: 0,
	});

	const errorResult = (msg: string, mode: string) => ({
		content: [
			{
				type: "text" as const,
				text: formatResultMarkdown({ agent: "", description: "", output: "", error: msg }, mode),
			},
		],
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
				// task_id continuation: look up existing background task
				if (p.task_id && taskRegistry) {
					const contResult = await continueSubagent({
						sessionId: p.task_id,
						task: p.prompt ?? p.description ?? "",
						taskRegistry,
						onUpdate: (text) =>
							onUpdate?.({
								content: [{ type: "text", text }],
								details: emptyDetails("single"),
							}),
					});
					return {
						content: [
							{
								type: "text" as const,
								text: formatResultMarkdown(contResult, "single"),
							},
						],
						details: {
							mode: "single",
							results: [contResult],
							totalCost: contResult.usage?.cost ?? 0,
							totalTurns: contResult.usage?.turns ?? 0,
						} as SubagentToolDetails,
					};
				}

				if (p.subagent_type && !p.agent) {
					p.agent = p.subagent_type;
				}
				const taskText = p.prompt ?? p.description ?? "";
				if (!p.agent || !taskText) {
					return errorResult(
						"agent (or subagent_type) and description (or prompt) required for single mode",
						"single",
					);
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
					task: taskText,
					cwd,
					services,
					parentModel,
					signal,
					category: p.category,
					loadSkills: p.load_skills,
					runInBackground: p.run_in_background,
					taskRegistry,
					parentSessionId,
					onBackgroundComplete,
					onUpdate: (text) =>
						onUpdate?.({
							content: [{ type: "text", text }],
							details: emptyDetails("single"),
						}),
				});

				return {
					content: [
						{
							type: "text" as const,
							text: formatResultMarkdown(result, "single"),
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

				const totalCost = results.reduce((s, r) => s + (r.usage?.cost ?? 0), 0);
				const totalTurns = results.reduce((s, r) => s + (r.usage?.turns ?? 0), 0);

				const taskSections = results
					.map((r) => formatResultMarkdown(r, "parallel"))
					.join("\n---\n");

				return {
					content: [{ type: "text" as const, text: taskSections }],
					details: {
						mode: "parallel",
						results,
						totalCost,
						totalTurns,
					} as SubagentToolDetails,
				};
			}

			// chain mode
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

			const totalCost = chainResults.reduce((s, r) => s + (r.usage?.cost ?? 0), 0);
			const totalTurns = chainResults.reduce((s, r) => s + (r.usage?.turns ?? 0), 0);

			const chainSections = chainResults
				.map((r, i) => {
					const header = `### Step ${i + 1}/${tasks.length}`;
					return `${header}\n${formatResultMarkdown(r, "chain")}`;
				})
				.join("\n---\n");

			return {
				content: [{ type: "text" as const, text: chainSections }],
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
