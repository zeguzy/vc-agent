import type { SubagentServices } from "../agents/types.js";
import type {
	MemberId,
	MemberStatus,
	ResolvedTeamConfig,
	TeamMember,
	TeamMessage,
	TeamTask,
	WorkerEventEnvelope,
	WorkerId,
	WorkerSessionPoolLike,
	WorkerSnapshot,
	WorkerSpawnOptions,
	WorkerStatus,
} from "./types.js";
import { generateMemberId } from "./types.js";
import { Worker as WorkerClass } from "./worker.js";

export type WorkerFactory = typeof WorkerClass.create;

export class WorkerSessionPool implements WorkerSessionPoolLike {
	private readonly workers = new Map<WorkerId, WorkerClass>();
	private readonly listeners = new Set<(event: WorkerEventEnvelope) => void>();
	private readonly config: ResolvedTeamConfig;
	private readonly services: SubagentServices;
	private disposed = false;
	private readonly slotResolvers: Array<() => void> = [];
	static workerFactory: WorkerFactory = WorkerClass.create;

	// V2 Team — member/task/message registries
	private readonly members = new Map<MemberId, TeamMember>();
	private readonly tasks = new Map<string, TeamTask>();
	private readonly messages: TeamMessage[] = [];
	private readonly memberRateLimits = new Map<MemberId, number[]>();

	constructor(config: ResolvedTeamConfig, services: SubagentServices) {
		this.config = config;
		this.services = services;
	}

	runningCount(): number {
		let count = 0;
		for (const w of this.workers.values()) {
			const s = w.getStatus();
			if (s === "running" || s === "idle") count++;
		}
		return count;
	}

	async spawnWorker(
		opts: WorkerSpawnOptions,
	): Promise<{ workerId: WorkerId; status: WorkerStatus }> {
		if (this.disposed) throw new Error("worker pool is disposed");
		if (this.runningCount() >= this.config.maxWorkers) {
			await new Promise<void>((resolve) => {
				this.slotResolvers.push(resolve);
			});
			if (this.disposed) throw new Error("worker pool was disposed while queued");
		}
		const worker = await WorkerSessionPool.workerFactory({
			agent: opts.agent,
			task: opts.task,
			cwd: opts.cwd,
			services: this.services,
			parentModel: opts.parentModel,
			defaultMaxTurns: this.config.defaultMaxTurns,
			signal: opts.signal,
			onDelta: opts.onDelta,
		});
		this.workers.set(worker.id, worker);
		worker.subscribe((event) => {
			for (const listener of this.listeners) {
				try {
					listener(event);
				} catch (err) {
					console.error(`[teams] pool event listener threw: ${err}`);
				}
			}
			if (event.kind === "agent_end" || event.kind === "error" || event.kind === "cancelled") {
				const next = this.slotResolvers.shift();
				if (next) next();
			}
		});
		return { workerId: worker.id, status: worker.getStatus() };
	}

	get(id: WorkerId): WorkerSnapshot | undefined {
		return this.workers.get(id)?.snapshot();
	}

	list(): WorkerSnapshot[] {
		const out: WorkerSnapshot[] = [];
		for (const w of this.workers.values()) out.push(w.snapshot());
		return out;
	}

	async cancel(id: WorkerId): Promise<void> {
		const w = this.workers.get(id);
		if (!w) return;
		await w.cancel();
		const next = this.slotResolvers.shift();
		if (next) next();
	}

	async cancelAll(): Promise<void> {
		const entries = Array.from(this.workers.values());
		await Promise.all(
			entries.map(async (w) => {
				try {
					await w.cancel();
				} catch (err) {
					console.error(`[teams] cancel worker ${w.id} error: ${err}`);
				}
			}),
		);
		for (const w of entries) {
			const next = this.slotResolvers.shift();
			if (next) next();
		}
	}

	subscribe(listener: (event: WorkerEventEnvelope) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	// ── V2 Team Member Management ──

	createMember(opts: {
		name: string;
		role: string;
		goal: string;
		model?: string;
		tools?: string[];
		systemPrompt?: string;
	}): TeamMember {
		if (this.disposed) throw new Error("team is disposed");
		if (this.idleMemberCount() >= this.config.maxIdleMembers) {
			throw new Error(`max idle members (${this.config.maxIdleMembers}) reached`);
		}
		const id = generateMemberId();
		const member: TeamMember = {
			id,
			name: opts.name,
			role: opts.role,
			goal: opts.goal,
			status: "idle",
			model: opts.model ?? this.config.defaultWorkerModel ?? "default",
			tools: opts.tools,
			systemPrompt: opts.systemPrompt,
			context: [],
			turnCount: 0,
			inputTokens: 0,
			outputTokens: 0,
			cost: 0,
			lastSummary: null,
			lastError: null,
			createdAt: Date.now(),
		};
		this.members.set(id, member);
		return member;
	}

	removeMember(id: MemberId): void {
		const member = this.members.get(id);
		if (!member) return;
		if (member.status === "working") {
			throw new Error(`member ${id} is currently working — cancel first`);
		}
		this.members.delete(id);
		this.memberRateLimits.delete(id);
	}

	getMember(id: MemberId): TeamMember | undefined {
		return this.members.get(id);
	}

	listMembers(): TeamMember[] {
		return [...this.members.values()];
	}

	private idleMemberCount(): number {
		let count = 0;
		for (const m of this.members.values()) {
			if (m.status === "idle") count++;
		}
		return count;
	}

	// ── V2 Task Pool ──

	createTask(opts: {
		title: string;
		description: string;
		priority?: "high" | "medium" | "low";
	}): TeamTask {
		const id = `task_${generateMemberId().slice(4, 12)}`;
		const task: TeamTask = {
			id,
			title: opts.title,
			description: opts.description,
			status: "open",
			priority: opts.priority ?? "medium",
		};
		this.tasks.set(id, task);
		return task;
	}

	assignTask(opts: {
		title: string;
		description: string;
		memberId: MemberId;
		priority?: "high" | "medium" | "low";
	}): TeamTask {
		const member = this.members.get(opts.memberId);
		if (!member) throw new Error(`member ${opts.memberId} not found`);
		if (this.runningCount() >= this.config.maxWorkers) {
			throw new Error(`max running members (${this.config.maxWorkers}) reached`);
		}
		const task = this.createTask({
			title: opts.title,
			description: opts.description,
			priority: opts.priority,
		});
		task.assignedTo = opts.memberId;
		task.status = "in_progress";
		this.startMember(opts.memberId, task);
		return task;
	}

	private startMember(memberId: MemberId, task: TeamTask): void {
		const member = this.members.get(memberId);
		if (!member) return;
		member.status = "working";
		const workerOpts: WorkerSpawnOptions = {
			agent: {
				name: member.name,
				description: `${member.role}: ${member.goal}`,
				tools: member.tools ?? ["read", "grep", "find", "bash"],
				systemPrompt:
					member.systemPrompt ??
					`You are ${member.name}, a ${member.role}. Your goal: ${member.goal}.`,
				source: "project",
				filePath: "(team)",
				model: member.model,
			},
			task: task.description,
			cwd: this.services.authStorage as unknown as string,
			services: this.services,
			defaultMaxTurns: this.config.defaultMaxTurns,
		};
		// Delegate to existing spawnWorker which handles session creation + event forwarding
		this.spawnWorker(workerOpts)
			.then((result) => {
				task.status = result.status === "error" ? "blocked" : "in_progress";
			})
			.catch(() => {
				task.status = "blocked";
				task.blockReason = "spawn failed";
			});
	}

	listTasks(): TeamTask[] {
		return [...this.tasks.values()];
	}

	taskStatus(taskId: string): TeamTask | undefined {
		return this.tasks.get(taskId);
	}

	// ── V2 Inter-Member Communication ──

	sendMessage(from: MemberId, to: MemberId | "team", content: string): void {
		if (!this.members.has(from)) throw new Error(`sender ${from} not found`);
		if (to !== "team" && !this.members.has(to)) throw new Error(`recipient ${to} not found`);
		const now = Date.now();
		const recent = this.memberRateLimits.get(from) ?? [];
		recent.push(now);
		while (recent.length > 0 && recent[0] < now - 60000) recent.shift();
		this.memberRateLimits.set(from, recent);
		if (recent.length > this.config.messageRateLimitPerMinute) {
			throw new Error(
				`message rate limit (${this.config.messageRateLimitPerMinute}/min) exceeded for ${from}`,
			);
		}
		const truncated = content.length > 2048 ? `${content.slice(0, 2048)}…[truncated]` : content;
		const msg: TeamMessage = {
			id: `msg_${generateMemberId().slice(4, 12)}`,
			from,
			to,
			content: truncated,
			timestamp: now,
		};
		this.messages.push(msg);
		while (this.messages.length > this.config.messageHistoryLimit) this.messages.shift();
	}

	readInbox(memberId?: MemberId): TeamMessage[] {
		if (memberId) {
			return this.messages.filter(
				(m) => m.to === memberId || m.to === "team" || m.from === memberId,
			);
		}
		return [...this.messages];
	}

	// ── Lifecycle ──

	async dispose(): Promise<void> {
		if (this.disposed) return;
		this.disposed = true;
		for (const resolve of this.slotResolvers) resolve();
		this.slotResolvers.length = 0;
		await this.cancelAll();
		for (const w of this.workers.values()) w.dispose();
		this.workers.clear();
		this.listeners.clear();
		this.members.clear();
		this.tasks.clear();
		this.messages.length = 0;
		this.memberRateLimits.clear();
	}
}
