import { homedir } from "node:os";
import { join } from "node:path";
import {
	type AgentSessionEvent,
	createAgentSession,
	DefaultResourceLoader,
} from "@earendil-works/pi-coding-agent";
import { BUILTIN_TOOLS, resolveModel } from "../agent/session.js";
import type { AgentConfig, SubagentServices } from "../agents/types.js";
import { extractAssistantText } from "../utils/content.js";
import { logTeamEvent } from "./logger.js";
import type { ResolvedModel } from "./types.js";

export type WorkerId = string;
export type WorkerStatus = "running" | "idle" | "done" | "error" | "cancelled";
export type WorkerEventKind =
	| "message_delta"
	| "message_end"
	| "tool_call"
	| "tool_result"
	| "agent_end"
	| "error"
	| "cancelled";

export interface WorkerEventEnvelope {
	readonly type: "team_worker_event";
	readonly workerId: WorkerId;
	readonly workerAgent: string;
	readonly kind: WorkerEventKind;
	readonly payload: AgentSessionEvent;
	readonly lastError?: string;
}

export interface WorkerSnapshot {
	id: WorkerId;
	agent: string;
	status: WorkerStatus;
	turnCount: number;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	cost: number;
	lastSummary: string | null;
	lastError: string | null;
	createdAt: number;
}

export interface WorkerSpawnOptions {
	agent: AgentConfig;
	task: string;
	cwd: string;
	services: SubagentServices;
	parentModel?: ResolvedModel;
	defaultMaxTurns?: number;
	defaultWorkerModel?: string;
	signal?: AbortSignal;
	onDelta?: (text: string) => void;
}

export interface WorkerEventEmitter {
	emit(kind: WorkerEventKind, payload: AgentSessionEvent, lastError?: string): void;
	subscribe(listener: (event: WorkerEventEnvelope) => void): () => void;
	dispose(): void;
}

function generateWorkerId(): WorkerId {
	const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
	const rand = new Uint8Array(8);
	(globalThis.crypto as Crypto).getRandomValues(rand);
	let suffix = "";
	for (const b of rand) suffix += alphabet[b % 32];
	return `wkr_${suffix}`;
}

export const AGENT_DIR = join(homedir(), ".config", "openagent");

const PERMISSION_DEFAULT_DENIED = ["edit", "write"] as const;
const PERMISSION_PLAN_DENIED = ["edit", "write", "bash"] as const;

const NEVER_INJECTED_TOOLS = new Set<string>([
	"question",
	"lsp",
	"lsp_diagnostics",
	"lsp_goto_definition",
	"lsp_find_references",
	"lsp_rename",
	"lsp_prepare_rename",
	"lsp_symbols",
	"lsp_status",
]);

export function deniedToolsFor(mode: AgentConfig["permissionMode"]): readonly string[] {
	if (mode === "plan") return PERMISSION_PLAN_DENIED;
	if (mode === "default") return PERMISSION_DEFAULT_DENIED;
	return [];
}

export function resolveTools(agent: AgentConfig, disqualified: readonly string[]): string[] {
	const base = agent.tools ?? BUILTIN_TOOLS;
	const disallowed = new Set<string>([...disqualified, ...(agent.disallowedTools ?? [])]);
	const filtered: string[] = [];
	const warned = new Set<string>();
	for (const tool of base) {
		if (NEVER_INJECTED_TOOLS.has(tool)) {
			if (!warned.has(tool)) {
				console.error(
					`[teams] worker "${agent.name}": tool "${tool}" is never injected into workers — removing from active tools`,
				);
				warned.add(tool);
			}
			continue;
		}
		if (disallowed.has(tool)) continue;
		filtered.push(tool);
	}
	return filtered;
}

export const WORKER_NEVER_INJECTED_TOOLS = NEVER_INJECTED_TOOLS;

export function classifyEventForTest(event: AgentSessionEvent): WorkerEventKind | null {
	return classifyEvent(event);
}

class WorkerEventBus implements WorkerEventEmitter {
	private listeners = new Set<(event: WorkerEventEnvelope) => void>();
	private workerId: WorkerId;
	private workerAgent: string;

	constructor(workerId: WorkerId, workerAgent: string) {
		this.workerId = workerId;
		this.workerAgent = workerAgent;
	}

	emit(kind: WorkerEventKind, payload: AgentSessionEvent, lastError?: string): void {
		const envelope: WorkerEventEnvelope = {
			type: "team_worker_event",
			workerId: this.workerId,
			workerAgent: this.workerAgent,
			kind,
			payload,
			lastError,
		};
		for (const listener of this.listeners) {
			try {
				listener(envelope);
			} catch (err) {
				console.error(`[teams] worker event listener threw: ${err}`);
			}
		}
	}

	subscribe(listener: (event: WorkerEventEnvelope) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	dispose(): void {
		this.listeners.clear();
	}
}

function classifyEvent(event: AgentSessionEvent): WorkerEventKind | null {
	switch (event.type) {
		case "message_update":
			return "message_delta";
		case "message_end":
			return event.message.role === "assistant" ? "message_end" : null;
		case "tool_execution_start":
			return "tool_call";
		case "tool_execution_end":
			return "tool_result";
		case "agent_end":
			return "agent_end";
		default:
			return null;
	}
}

export class Worker {
	readonly id: WorkerId;
	readonly agent: string;
	readonly createdAt: number;
	private status: WorkerStatus = "idle";
	private turnCount = 0;
	private inputTokens = 0;
	private outputTokens = 0;
	private cacheReadTokens = 0;
	private cacheWriteTokens = 0;
	private cost = 0;
	private lastSummary: string | null = null;
	private lastError: string | null = null;
	private readonly eventBus: WorkerEventBus;
	private readonly maxTurns: number;
	private readonly disposer: () => void;
	private runPromise: Promise<void> | null = null;

	private constructor(opts: {
		id: WorkerId;
		agent: string;
		maxTurns: number;
		eventBus: WorkerEventBus;
		disposer: () => void;
	}) {
		this.id = opts.id;
		this.agent = opts.agent;
		this.createdAt = Date.now();
		this.maxTurns = opts.maxTurns;
		this.eventBus = opts.eventBus;
		this.disposer = opts.disposer;
	}

	static async create(opts: WorkerSpawnOptions): Promise<Worker> {
		const { agent, task, cwd, services, parentModel, signal, onDelta } = opts;
		const id = generateWorkerId();
		const eventBus = new WorkerEventBus(id, agent.name);
		console.error(
			`[teams] Worker.create: parentModel=${parentModel ? `yes(id=${(parentModel as { id?: string }).id},provider=${(parentModel as { provider?: string }).provider})` : "none"} agent.model=${agent.model ?? "none"} opts.defaultWorkerModel=${opts.defaultWorkerModel ?? "none"}`,
		);

		// parentModel takes precedence over agent.model: when a parent session
		// supplies its own resolved model, the worker should inherit the
		// parent's provider/auth rather than re-resolving from a string that
		// may land on a different provider (e.g. "deepseek/deepseek-v4-pro"
		// matches the openrouter provider's model id, not deepseek's).
		const model = parentModel
			? parentModel
			: agent.model
				? resolveModel(services.modelRegistry, agent.model)
				: opts.defaultWorkerModel
					? resolveModel(services.modelRegistry, opts.defaultWorkerModel)
					: undefined;
		logTeamEvent("worker_create", {
			workerId: id,
			parentModel: parentModel
				? `yes(id=${(parentModel as { id?: string }).id},provider=${(parentModel as { provider?: string }).provider})`
				: "no",
			agentModel: agent.model ?? "none",
			resolvedModel: model
				? `${(model as { id?: string }).id} provider=${(model as { provider?: string }).provider}`
				: "none",
		});
		if (!model) {
			throw new Error(
				`worker "${agent.name}": no model resolved (agent.model=${agent.model ?? "none"}, defaultWorkerModel=${opts.defaultWorkerModel ?? "none"})`,
			);
		}

		console.error(
			`[teams] Worker.create: model=${(model as { id?: string }).id} provider=${(model as { provider?: string }).provider} parentModel=${parentModel ? "yes" : "no"} agent.model=${agent.model ?? "none"}`,
		);

		const resourceLoader = new DefaultResourceLoader({
			cwd,
			agentDir: AGENT_DIR,
			settingsManager: services.settingsManager,
			appendSystemPrompt: [agent.systemPrompt],
			noExtensions: true,
			noSkills: true,
			noContextFiles: true,
		});

		const denied = deniedToolsFor(agent.permissionMode);
		const tools = resolveTools(agent, denied);

		const { session } = await createAgentSession({
			cwd,
			agentDir: AGENT_DIR,
			authStorage: services.authStorage,
			modelRegistry: services.modelRegistry,
			model,
			settingsManager: services.settingsManager,
			tools,
			resourceLoader,
		});

		const worker = new Worker({
			id,
			agent: agent.name,
			maxTurns: agent.maxTurns ?? opts.defaultMaxTurns ?? 8,
			eventBus,
			disposer: () => session.dispose(),
		});

		const unsub = session.subscribe((event) => {
			const kind = classifyEvent(event);
			if (!kind) return;

			// When the worker is already in a terminal state (error/cancelled),
			// Pi SDK's agent_end should not be re-emitted as "agent_end" —
			// the finally block will emit the correct terminal kind.
			if (
				event.type === "agent_end" &&
				(worker.status === "error" || worker.status === "cancelled")
			) {
				return;
			}

			eventBus.emit(kind, event);

			if (event.type === "agent_end") {
				logTeamEvent("worker_got_agent_end", {
					workerId: id,
					agent: agent.name,
					status: worker.status,
					turnCount: worker.turnCount,
				});
			}
			if (event.type === "turn_end") {
				logTeamEvent("worker_got_turn_end", {
					workerId: id,
					agent: agent.name,
					turnCount: worker.turnCount,
					stopReason: (event as { message?: { stopReason?: string } }).message?.stopReason,
				});
			}

			if (event.type === "message_end" && event.message.role === "assistant") {
				worker.turnCount++;
				console.error(
					`[teams] worker "${agent.name}" message_end: turnCount=${worker.turnCount} maxTurns=${worker.maxTurns} status=${worker.status}`,
				);
				const u = event.message.usage;
				worker.inputTokens += u.input;
				worker.outputTokens += u.output;
				worker.cacheReadTokens += u.cacheRead;
				worker.cacheWriteTokens += u.cacheWrite;
				worker.cost += u.cost.total;
				const text = extractAssistantText(event.message.content);
				if (text) {
					worker.lastSummary = text;
					onDelta?.(text);
				}

				if (worker.turnCount >= worker.maxTurns && worker.status === "running") {
					worker.status = "error";
					worker.lastError = `maxTurns limit (${worker.maxTurns}) reached`;
					session.abort();
				}
			}
		});

		if (signal) {
			signal.addEventListener("abort", () => session.abort(), { once: true });
		}

		worker.status = "running";
		worker.runPromise = (async () => {
			// Defer prompt start by one tick so callers (pool) can subscribe
			// to worker events before any error/success fires.
			await new Promise((resolve) => setTimeout(resolve, 0));
			logTeamEvent("worker_prompt_start", {
				workerId: id,
				agent: agent.name,
				task: task.slice(0, 80),
			});
			try {
				await session.prompt(task);
				logTeamEvent("worker_prompt_resolved", {
					workerId: id,
					agent: agent.name,
					statusBefore: worker.status,
				});
				if (worker.status === "running" || worker.status === "idle") {
					worker.status = "done";
				}
			} catch (err) {
				const errMsg = err instanceof Error ? err.message : String(err);
				const errName = err instanceof Error ? err.name : "unknown";
				logTeamEvent("worker_prompt_rejected", {
					workerId: id,
					agent: agent.name,
					statusBeforeCatch: worker.status,
					errName,
					errMsg: errMsg.slice(0, 200),
				});
				console.error(
					`[teams] worker "${agent.name}" catch: status=${worker.status} err=${errMsg}`,
				);
				if (worker.status !== "cancelled" && worker.status !== "error") {
					worker.status = "error";
					worker.lastError = errMsg;
				}
			} finally {
				logTeamEvent("worker_finally", {
					workerId: id,
					agent: agent.name,
					status: worker.status,
					lastError: worker.lastError,
				});
				const finalKind =
					worker.status === "done" || worker.status === "running" || worker.status === "idle"
						? "agent_end"
						: (worker.status as WorkerEventKind);
				eventBus.emit(
					finalKind,
					{ type: "agent_end" } as AgentSessionEvent,
					worker.lastError ?? undefined,
				);
				unsub();
				session.dispose();
			}
		})();

		return worker;
	}

	getStatus(): WorkerStatus {
		return this.status;
	}

	snapshot(): WorkerSnapshot {
		return {
			id: this.id,
			agent: this.agent,
			status: this.status,
			turnCount: this.turnCount,
			inputTokens: this.inputTokens,
			outputTokens: this.outputTokens,
			cacheReadTokens: this.cacheReadTokens,
			cacheWriteTokens: this.cacheWriteTokens,
			cost: this.cost,
			lastSummary: this.lastSummary,
			lastError: this.lastError,
			createdAt: this.createdAt,
		};
	}

	subscribe(listener: (event: WorkerEventEnvelope) => void): () => void {
		return this.eventBus.subscribe(listener);
	}

	async cancel(): Promise<void> {
		if (this.status === "done" || this.status === "error" || this.status === "cancelled") return;
		this.status = "cancelled";
		try {
			this.disposer();
		} catch (err) {
			console.error(`[teams] worker ${this.id} cancel dispose error: ${err}`);
		}
		if (this.runPromise) {
			try {
				await this.runPromise;
			} catch {
				// already handled by status assignment above
			}
		}
	}

	async join(): Promise<void> {
		if (this.runPromise) await this.runPromise;
	}

	dispose(): void {
		this.eventBus.dispose();
	}
}
