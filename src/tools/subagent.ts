import type { AgentSession, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { discoverAgents } from "../agents/discover.js";
import { createSubagentSession, runSubagent } from "../agents/runner.js";
import type {
	AgentConfig,
	SubagentResult,
	SubagentServices,
	SubagentToolDetails,
	SubagentToolParams,
} from "../agents/types.js";
import { MAX_OUTPUT_CHARS, MAX_PARALLEL_TASKS, PARALLEL_CONCURRENCY } from "../agents/types.js";
import type { BackgroundJobRef } from "../background/service.js";
import type { SessionRef } from "../background/types.js";
import { wrapNotification } from "../session/btw.js";
import { extractAssistantText } from "../utils/content.js";

const PREVIEW_MAX_CHARS = 5000;

type ResolvedModel = NonNullable<ReturnType<typeof import("../agent/session.js").resolveModel>>;

interface SubagentToolOptions {
	cwd: string;
	services: SubagentServices;
	parentModel?: ResolvedModel;
	/** Process-wide background job service. Required for `background: true`. */
	backgroundJobRef?: BackgroundJobRef;
	/** Parent session, populated after createAgentSession returns. */
	parentSessionRef?: SessionRef;
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
	background: Type.Optional(
		Type.Boolean({
			description:
				"Run in background (single mode only). Returns immediately with a task ID; result is injected into the parent session on completion. Do NOT poll or sleep.",
		}),
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

interface StartBackgroundOpts {
	agentConfig: AgentConfig;
	task: string;
	cwd: string;
	services: SubagentServices;
	parentModel?: ResolvedModel;
	backgroundJobRef?: BackgroundJobRef;
	parentSessionRef?: SessionRef;
}

async function startBackgroundSubagent(
	opts: StartBackgroundOpts,
): ReturnType<NonNullable<ToolDefinition["execute"]>> {
	const { agentConfig, task, cwd, services, parentModel, backgroundJobRef, parentSessionRef } =
		opts;

	const bgSvc = backgroundJobRef?.current;
	const parentSession = parentSessionRef?.current;
	const emptyDetails = (): SubagentToolDetails => ({
		mode: "single",
		results: [],
		totalCost: 0,
		totalTurns: 0,
	});
	if (!bgSvc) {
		return {
			content: [
				{
					type: "text",
					text: '<subagent-result status="failed" mode="single">\n<error>background mode unavailable: BackgroundJobService not wired</error>\n</subagent-result>',
				},
			],
			details: emptyDetails(),
		};
	}

	const childSession: AgentSession = await createSubagentSession({
		agent: agentConfig,
		cwd,
		services,
		parentModel,
	});

	bgSvc.start({
		id: childSession.sessionId,
		type: "subagent",
		title: task,
		session: childSession,
		run: async () => {
			let lastText = "";
			const unsub = childSession.subscribe((event) => {
				if (event.type === "message_end" && event.message.role === "assistant") {
					const text = extractAssistantText(event.message.content);
					if (text) lastText = text;
				}
			});
			try {
				await childSession.prompt(task);
				return lastText || "(subagent produced no text output)";
			} finally {
				unsub();
			}
		},
		onComplete: (job) => {
			if (!parentSession) return;
			const body =
				job.status === "completed"
					? `[BACKGROUND SUBAGENT COMPLETED: ${job.title}]\n${job.output ?? "(no output)"}\n[END BACKGROUND SUBAGENT]`
					: job.status === "error"
						? `[BACKGROUND SUBAGENT ERROR: ${job.title}]\n${job.error ?? "unknown error"}\n[END BACKGROUND SUBAGENT]`
						: `[BACKGROUND SUBAGENT CANCELLED: ${job.title}]\n[END BACKGROUND SUBAGENT]`;
			const note = wrapNotification(body);
			if (parentSession.isStreaming) {
				parentSession.steer(note);
			} else {
				void parentSession.prompt(note);
			}
		},
	});

	return {
		content: [
			{
				type: "text",
				text: `Background task started: ${task}\nTask ID: ${childSession.sessionId}\nYou will be notified when it completes.`,
			},
		],
		details: emptyDetails(),
	};
}

export function createSubagentTool(options: SubagentToolOptions): ToolDefinition {
	const { cwd, services, parentModel, backgroundJobRef, parentSessionRef } = options;

	const initialAgents = discoverAgents(cwd).agents;
	const agentList = formatAgentNames(initialAgents);

	const DESCRIPTION = [
		`Delegate tasks to specialized subagents with isolated context windows. Available agents: see system prompt for the full list (${initialAgents.length} total).`,
		"Modes: single (one agent, one task), parallel (multiple tasks concurrently, max 8), chain (sequential, {previous} placeholder).",
		"Each delegation prompt MUST include: specific GOAL, relevant file CONTEXT, and clear SCOPE boundaries.",
		"Vague prompts produce poor results — be exhaustive in your task description.",
		"The result returned by the subagent is not visible to the user. To show the user the result, send a text message summarizing it.",
		"Background mode: set background=true (single mode only) to run the subagent asynchronously. You get a task ID immediately and can continue other work. When the task finishes, its result is injected into your session automatically — no need to wait. Use task_status to check progress if needed, and task_cancel to abort a background task.",
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
				text: `<subagent-result status="failed" mode="${mode}">\n<error>${msg}</error>\n</subagent-result>`,
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

				if (p.background === true) {
					return await startBackgroundSubagent({
						agentConfig,
						task: p.description,
						cwd,
						services,
						parentModel,
						backgroundJobRef,
						parentSessionRef,
					});
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

				const preview = truncate(result.output, PREVIEW_MAX_CHARS);
				const status = result.error ? "failed" : "completed";
				const errorTag = result.error ? `\n<error>${result.error}</error>` : "";
				return {
					content: [
						{
							type: "text" as const,
							text: `<subagent-result agent="${result.agent}" status="${status}" mode="single">\n<output>\n${preview}\n</output>${errorTag}\n</subagent-result>`,
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

				const taskTags = results.map((r) => {
					const preview = truncate(r.output, PREVIEW_MAX_CHARS);
					const err = r.error ? `\n<error>${r.error}</error>` : "";
					return `  <task agent="${r.agent}">\n    <description>${r.description}</description>\n    <output>${preview}</output>${err}\n  </task>`;
				});
				const totalCost = results.reduce((s, r) => s + (r.usage?.cost ?? 0), 0);
				const totalTurns = results.reduce((s, r) => s + (r.usage?.turns ?? 0), 0);
				const status = results.every((r) => !r.error) ? "completed" : "failed";

				return {
					content: [
						{
							type: "text" as const,
							text: `<subagent-result mode="parallel" status="${status}">\n${taskTags.join("\n")}\n</subagent-result>`,
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

			const stepTags = chainResults.map((r, i) => {
				const preview = truncate(r.output, PREVIEW_MAX_CHARS);
				const err = r.error ? `\n    <error>${r.error}</error>` : "";
				return `  <task agent="${r.agent}" step="${i + 1}">\n    <output>${preview}</output>${err}\n  </task>`;
			});
			const totalCost = chainResults.reduce((s, r) => s + (r.usage?.cost ?? 0), 0);
			const totalTurns = chainResults.reduce((s, r) => s + (r.usage?.turns ?? 0), 0);
			const allDone = chainResults.length === tasks.length && chainResults.every((r) => !r.error);
			const status = allDone ? "completed" : "failed";

			return {
				content: [
					{
						type: "text" as const,
						text: `<subagent-result mode="chain" status="${status}" steps="${chainResults.length}/${tasks.length}">\n${stepTags.join("\n")}\n</subagent-result>`,
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
