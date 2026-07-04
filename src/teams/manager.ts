import type { SubagentServices } from "../agents/types.js";
import type {
	ResolvedTeamConfig,
	WorkerEventEnvelope,
	WorkerId,
	WorkerSessionPoolLike,
	WorkerSnapshot,
	WorkerSpawnOptions,
	WorkerStatus,
} from "./types.js";
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

	async dispose(): Promise<void> {
		if (this.disposed) return;
		this.disposed = true;
		for (const resolve of this.slotResolvers) resolve();
		this.slotResolvers.length = 0;
		await this.cancelAll();
		for (const w of this.workers.values()) w.dispose();
		this.workers.clear();
		this.listeners.clear();
	}
}
