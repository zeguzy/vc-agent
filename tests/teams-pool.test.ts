import { afterEach, describe, expect, it } from "bun:test";
import type { AgentConfig, SubagentServices } from "../src/agents/types.js";
import { WorkerSessionPool } from "../src/teams/manager.js";
import type {
	ResolvedTeamConfig,
	WorkerEventEnvelope,
	WorkerId,
	WorkerSnapshot,
	WorkerSpawnOptions,
} from "../src/teams/types.js";

class FakeWorker {
	readonly id: WorkerId;
	readonly agent: string;
	readonly createdAt: number;
	private status: WorkerSnapshot["status"];
	private cancelled = false;
	private disposed = false;
	private readonly listeners = new Set<(event: WorkerEventEnvelope) => void>();
	readonly snapshots: WorkerSnapshot;

	constructor(id: WorkerId, agent: string, snapshot: Partial<WorkerSnapshot> = {}) {
		this.id = id;
		this.agent = agent;
		this.createdAt = Date.now();
		this.status = "running";
		this.snapshots = {
			id,
			agent,
			status: "running",
			turnCount: 0,
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			cost: 0,
			lastSummary: null,
			lastError: null,
			createdAt: this.createdAt,
			...snapshot,
		};
	}

	getStatus(): WorkerSnapshot["status"] {
		return this.status;
	}

	snapshot(): WorkerSnapshot {
		return { ...this.snapshots, status: this.status };
	}

	subscribe(listener: (event: WorkerEventEnvelope) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	emit(event: WorkerEventEnvelope): void {
		for (const listener of this.listeners) listener(event);
	}

	async cancel(): Promise<void> {
		this.cancelled = true;
		this.status = "cancelled";
	}

	dispose(): void {
		this.disposed = true;
		this.listeners.clear();
	}

	get wasCancelled(): boolean {
		return this.cancelled;
	}

	get wasDisposed(): boolean {
		return this.disposed;
	}
}

function makeConfig(overrides: Partial<ResolvedTeamConfig> = {}): ResolvedTeamConfig {
	return {
		enabled: true,
		maxWorkers: 2,
		defaultMaxTurns: 8,
		isolation: "none",
		cancelOrphansOnAgentEnd: true,
		cancelOrphansOnSessionChange: true,
		...overrides,
	};
}

function makeServices(): SubagentServices {
	return {
		authStorage: {} as never,
		modelRegistry: { getAll: () => [] } as never,
		settingsManager: {} as never,
	};
}

function makeAgent(name = "test"): AgentConfig {
	return {
		name,
		description: "test",
		systemPrompt: "",
		source: "project",
		filePath: "/tmp/test.md",
	};
}

function makeSpawnOptions(agent = makeAgent()): WorkerSpawnOptions {
	return {
		agent,
		task: "do thing",
		cwd: "/tmp",
		services: makeServices(),
	};
}

let nextId = 0;
let createdWorkers: FakeWorker[] = [];
const originalFactory = WorkerSessionPool.workerFactory;

function installFakeFactory() {
	createdWorkers = [];
	nextId = 0;
	WorkerSessionPool.workerFactory = (async (opts: WorkerSpawnOptions) => {
		const id = `wkr_fake${nextId++}`;
		const w = new FakeWorker(id, opts.agent.name);
		createdWorkers.push(w);
		return w as unknown as Awaited<ReturnType<typeof originalFactory>>;
	}) as typeof originalFactory;
}

function restoreFactory() {
	WorkerSessionPool.workerFactory = originalFactory;
}

afterEach(() => {
	restoreFactory();
});

describe("WorkerSessionPool", () => {
	it("spawnWorker admits within maxWorkers", async () => {
		installFakeFactory();
		const pool = new WorkerSessionPool(makeConfig({ maxWorkers: 2 }), makeServices(), "/tmp");
		const r1 = await pool.spawnWorker(makeSpawnOptions());
		expect(r1.status).toBe("running");
		expect(pool.runningCount()).toBe(1);
		const r2 = await pool.spawnWorker(makeSpawnOptions());
		expect(r2.status).toBe("running");
		expect(pool.runningCount()).toBe(2);
	});

	it("spawnWorker queues when pool is full", async () => {
		installFakeFactory();
		const pool = new WorkerSessionPool(makeConfig({ maxWorkers: 1 }), makeServices(), "/tmp");
		await pool.spawnWorker(makeSpawnOptions());
		expect(pool.runningCount()).toBe(1);

		let resolved = false;
		const queued = pool.spawnWorker(makeSpawnOptions()).then(() => {
			resolved = true;
			return pool.list()[0];
		});
		await new Promise((r) => setTimeout(r, 50));
		expect(resolved).toBe(false);

		const [first] = [pool.list()[0]?.id].filter(Boolean) as string[];
		expect(first).toBeTruthy();
		await pool.cancel(first);
		await queued;
		expect(resolved).toBe(true);
	});

	it("spawnWorker rejects after dispose", async () => {
		installFakeFactory();
		const pool = new WorkerSessionPool(makeConfig(), makeServices(), "/tmp");
		await pool.dispose();
		await expect(pool.spawnWorker(makeSpawnOptions())).rejects.toThrow("disposed");
	});

	it("get returns snapshot; list returns all snapshots", async () => {
		installFakeFactory();
		const pool = new WorkerSessionPool(makeConfig({ maxWorkers: 3 }), makeServices(), "/tmp");
		const a = await pool.spawnWorker(makeSpawnOptions(makeAgent("a")));
		const _b = await pool.spawnWorker(makeSpawnOptions(makeAgent("b")));
		expect(pool.get(a.workerId)?.agent).toBe("a");
		expect(
			pool
				.list()
				.map((w) => w.agent)
				.sort(),
		).toEqual(["a", "b"]);
	});

	it("cancel invokes worker.cancel and updates runningCount", async () => {
		installFakeFactory();
		const pool = new WorkerSessionPool(makeConfig({ maxWorkers: 2 }), makeServices(), "/tmp");
		const r = await pool.spawnWorker(makeSpawnOptions());
		expect(pool.runningCount()).toBe(1);
		await pool.cancel(r.workerId);
		expect(pool.runningCount()).toBe(0);
		expect(createdWorkers[0]?.wasCancelled).toBe(true);
	});

	it("cancelAll cancels every worker", async () => {
		installFakeFactory();
		const pool = new WorkerSessionPool(makeConfig({ maxWorkers: 2 }), makeServices(), "/tmp");
		await pool.spawnWorker(makeSpawnOptions());
		await pool.spawnWorker(makeSpawnOptions());
		await pool.cancelAll();
		expect(createdWorkers.every((w) => w.wasCancelled)).toBe(true);
		expect(pool.runningCount()).toBe(0);
	});

	it("subscribe receives WorkerEventEnvelope emitted by a worker", async () => {
		installFakeFactory();
		const pool = new WorkerSessionPool(makeConfig(), makeServices(), "/tmp");
		const r = await pool.spawnWorker(makeSpawnOptions());
		const received: WorkerEventEnvelope[] = [];
		const unsub = pool.subscribe((event) => received.push(event));
		const fake = createdWorkers[0]!;
		const env: WorkerEventEnvelope = {
			type: "team_worker_event",
			workerId: r.workerId,
			workerAgent: "test",
			kind: "message_end",
			payload: { type: "agent_end" } as never,
		};
		fake.emit(env);
		expect(received).toEqual([env]);
		unsub();
		fake.emit(env);
		expect(received).toEqual([env]);
	});

	it("dispose cancels all workers, clears map, blocks further spawnWorker", async () => {
		installFakeFactory();
		const pool = new WorkerSessionPool(makeConfig({ maxWorkers: 2 }), makeServices(), "/tmp");
		await pool.spawnWorker(makeSpawnOptions());
		await pool.spawnWorker(makeSpawnOptions());
		await pool.dispose();
		expect(createdWorkers.every((w) => w.wasDisposed)).toBe(true);
		expect(pool.list()).toEqual([]);
	});

	it("cancel on unknown id is a no-op", async () => {
		installFakeFactory();
		const pool = new WorkerSessionPool(makeConfig(), makeServices(), "/tmp");
		await expect(pool.cancel("wkr_unknown")).resolves.toBeUndefined();
	});

	it("cancel on already-finished worker is idempotent", async () => {
		installFakeFactory();
		const pool = new WorkerSessionPool(makeConfig(), makeServices(), "/tmp");
		const r = await pool.spawnWorker(makeSpawnOptions());
		await pool.cancel(r.workerId);
		await pool.cancel(r.workerId);
		expect(pool.runningCount()).toBe(0);
	});

	it("runningCount excludes done/error/cancelled workers", async () => {
		installFakeFactory();
		const pool = new WorkerSessionPool(makeConfig({ maxWorkers: 2 }), makeServices(), "/tmp");
		const r = await pool.spawnWorker(makeSpawnOptions());
		await pool.cancel(r.workerId);
		expect(pool.runningCount()).toBe(0);
		const _r2 = await pool.spawnWorker(makeSpawnOptions());
		expect(pool.runningCount()).toBe(1);
	});
});
