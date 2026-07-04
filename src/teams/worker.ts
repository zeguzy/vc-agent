import { homedir } from "node:os";
import { join } from "node:path";
import {
	type AgentSessionEvent,
	createAgentSession,
	DefaultResourceLoader,
} from "@earendil-works/pi-coding-agent";
import { BUILTIN_TOOLS, resolveModel } from "../agent/session.js";
import type { AgentConfig } from "../agents/types.js";
import { extractAssistantText } from "../utils/content.js";
import {
	generateWorkerId,
	type WorkerEventEmitter,
	type WorkerEventEnvelope,
	type WorkerEventKind,
	type WorkerId,
	type WorkerSnapshot,
	type WorkerSpawnOptions,
	type WorkerStatus,
} from "./types.js";

const AGENT_DIR = join(homedir(), ".config", "openagent");

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

	emit(kind: WorkerEventKind, payload: AgentSessionEvent): void {
		const envelope: WorkerEventEnvelope = {
			type: "team_worker_event",
			workerId: this.workerId,
			workerAgent: this.workerAgent,
			kind,
			payload,
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

		const model = agent.model ? resolveModel(services.modelRegistry, agent.model) : parentModel;
		if (!model) {
			throw new Error(
				`worker "${agent.name}": no model resolved (agent.model=${agent.model ?? "none"})`,
			);
		}

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
			maxTurns: agent.maxTurns ?? 8,
			eventBus,
			disposer: () => session.dispose(),
		});

		const unsub = session.subscribe((event) => {
			const kind = classifyEvent(event);
			if (!kind) return;
			eventBus.emit(kind, event);

			if (event.type === "message_end" && event.message.role === "assistant") {
				worker.turnCount++;
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
			try {
				await session.prompt(task);
				if (worker.status === "running" || worker.status === "idle") {
					worker.status = "done";
				}
			} catch (err) {
				if (worker.status !== "cancelled" && worker.status !== "error") {
					worker.status = "error";
					worker.lastError = err instanceof Error ? err.message : String(err);
				}
			} finally {
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
