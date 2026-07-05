import { describe, expect, it } from "bun:test";
import type { AgentConfig, SubagentServices } from "../src/agents/types.js";
import { WorkerSessionPool } from "../src/teams/manager.js";
import type {
	ResolvedTeamConfig,
	WorkerEventEnvelope,
	WorkerId,
	WorkerSnapshot,
	WorkerSpawnOptions,
} from "../src/teams/types.js";

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

function makeAgent(name = "test-worker"): AgentConfig {
	return {
		name,
		description: "test",
		systemPrompt: "",
		source: "project",
		filePath: "/tmp/test.md",
		background: true,
	};
}

class FakeWorker {
	readonly id: WorkerId;
	readonly agent: string;
	readonly createdAt: number;
	private _status: WorkerSnapshot["status"] = "running";
	private _turns = 0;
	private _input = 0;
	private _output = 0;
	private _cost = 0;
	private _summary: string | null = null;
	private _error: string | null = null;
	private readonly _listeners = new Set<(event: WorkerEventEnvelope) => void>();

	constructor(id: WorkerId, agent: string) {
		this.id = id;
		this.agent = agent;
		this.createdAt = Date.now();
	}

	getStatus() {
		return this._status;
	}

	snapshot(): WorkerSnapshot {
		return {
			id: this.id,
			agent: this.agent,
			status: this._status,
			turnCount: this._turns,
			inputTokens: this._input,
			outputTokens: this._output,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			cost: this._cost,
			lastSummary: this._summary,
			lastError: this._error,
			createdAt: this.createdAt,
		};
	}

	subscribe(listener: (event: WorkerEventEnvelope) => void) {
		this._listeners.add(listener);
		return () => this._listeners.delete(listener);
	}

	emit(event: WorkerEventEnvelope) {
		for (const l of this._listeners) l(event);
	}

	finish(summary: string, turns = 3, input = 500, output = 200, cost = 0.005) {
		this._turns = turns;
		this._input = input;
		this._output = output;
		this._cost = cost;
		this._summary = summary;
		this._status = "done";
		this.emit({
			type: "team_worker_event",
			workerId: this.id,
			workerAgent: this.agent,
			kind: "agent_end",
			payload: { type: "agent_end" } as never,
		});
	}

	fail(error: string) {
		this._error = error;
		this._status = "error";
	}

	async cancel() {
		this._status = "cancelled";
	}
	dispose() {
		this._listeners.clear();
	}
}

describe("teams integration", () => {
	it("spawn → event propagation → poll snapshot", async () => {
		let nextId = 0;
		const created: FakeWorker[] = [];
		const originalFactory = WorkerSessionPool.workerFactory;

		WorkerSessionPool.workerFactory = (async (opts: WorkerSpawnOptions) => {
			const id = `wkr_int${nextId++}`;
			const w = new FakeWorker(id, opts.agent.name);
			created.push(w);
			return w as unknown as Awaited<ReturnType<typeof originalFactory>>;
		}) as typeof originalFactory;

		try {
			const pool = new WorkerSessionPool(makeConfig(), makeServices(), "/tmp");
			const events: WorkerEventEnvelope[] = [];
			pool.subscribe((e) => events.push(e));

			const { workerId, status } = await pool.spawnWorker({
				agent: makeAgent("integrator"),
				task: "run integration test",
				cwd: "/tmp",
				services: makeServices(),
			});

			expect(status).toBe("running");
			expect(created).toHaveLength(1);
			expect(pool.runningCount()).toBe(1);

			// worker should be in pool
			const snap = pool.get(workerId);
			expect(snap?.status).toBe("running");

			// event subscription should be connected
			expect(events).toHaveLength(0);

			// finish the worker
			created[0].finish("Integration test passed");
			await new Promise((r) => setTimeout(r, 50));

			// verify snapshot updated
			const done = pool.get(workerId);
			expect(done?.status).toBe("done");
			expect(done?.lastSummary).toBe("Integration test passed");
			expect(done?.turnCount).toBe(3);
			expect(pool.runningCount()).toBe(0);

			// verify pool subscription received event
			expect(events.length).toBeGreaterThanOrEqual(1);
			const agentEndEvent = events.find((e) => e.kind === "agent_end");
			expect(agentEndEvent?.workerId).toBe(workerId);
		} finally {
			WorkerSessionPool.workerFactory = originalFactory;
		}
	});

	it("spawnWorker queues when pool is full", async () => {
		const pool = new WorkerSessionPool(makeConfig({ maxWorkers: 1 }), makeServices(), "/tmp");
		const originalFactory = WorkerSessionPool.workerFactory;

		let nextId = 0;
		WorkerSessionPool.workerFactory = (async (opts: WorkerSpawnOptions) => {
			const id = `wkr_int${nextId++}`;
			return new FakeWorker(id, opts.agent.name) as unknown as Awaited<
				ReturnType<typeof originalFactory>
			>;
		}) as typeof originalFactory;

		try {
			const r1 = await pool.spawnWorker({
				agent: makeAgent("w1"),
				task: "task 1",
				cwd: "/tmp",
				services: makeServices(),
			});
			expect(pool.runningCount()).toBe(1);

			let resolved = false;
			const queued = pool
				.spawnWorker({
					agent: makeAgent("w2"),
					task: "task 2",
					cwd: "/tmp",
					services: makeServices(),
				})
				.then(() => {
					resolved = true;
				});
			await new Promise((r) => setTimeout(r, 50));
			expect(resolved).toBe(false);

			await pool.cancel(r1.workerId);
			await queued;
			expect(resolved).toBe(true);
		} finally {
			WorkerSessionPool.workerFactory = originalFactory;
		}
	});

	it("cancelAll cleans up and runningCount returns 0", async () => {
		const pool = new WorkerSessionPool(makeConfig({ maxWorkers: 3 }), makeServices(), "/tmp");
		const originalFactory = WorkerSessionPool.workerFactory;

		let nextId = 0;
		WorkerSessionPool.workerFactory = (async (opts: WorkerSpawnOptions) => {
			const id = `wkr_int${nextId++}`;
			return new FakeWorker(id, opts.agent.name) as unknown as Awaited<
				ReturnType<typeof originalFactory>
			>;
		}) as typeof originalFactory;

		try {
			await pool.spawnWorker({
				agent: makeAgent("a"),
				task: "t1",
				cwd: "/tmp",
				services: makeServices(),
			});
			await pool.spawnWorker({
				agent: makeAgent("b"),
				task: "t2",
				cwd: "/tmp",
				services: makeServices(),
			});
			expect(pool.runningCount()).toBe(2);

			await pool.cancelAll();
			expect(pool.runningCount()).toBe(0);
		} finally {
			WorkerSessionPool.workerFactory = originalFactory;
		}
	});

	it("dispose blocks further spawn and clears map", async () => {
		const pool = new WorkerSessionPool(makeConfig({ maxWorkers: 2 }), makeServices(), "/tmp");
		const originalFactory = WorkerSessionPool.workerFactory;

		let nextId = 0;
		WorkerSessionPool.workerFactory = (async (opts: WorkerSpawnOptions) => {
			const id = `wkr_int${nextId++}`;
			return new FakeWorker(id, opts.agent.name) as unknown as Awaited<
				ReturnType<typeof originalFactory>
			>;
		}) as typeof originalFactory;

		try {
			await pool.spawnWorker({
				agent: makeAgent("x"),
				task: "t",
				cwd: "/tmp",
				services: makeServices(),
			});
			await pool.dispose();

			expect(pool.list()).toEqual([]);
			await expect(
				pool.spawnWorker({
					agent: makeAgent("y"),
					task: "t",
					cwd: "/tmp",
					services: makeServices(),
				}),
			).rejects.toThrow("disposed");
		} finally {
			WorkerSessionPool.workerFactory = originalFactory;
		}
	});
});
