import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SubagentServices } from "../src/agents/types.js";
import { WorkerSessionPool } from "../src/teams/manager.js";
import { TeamStorage } from "../src/teams/storage.js";
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
		maxWorkers: 4,
		defaultMaxTurns: 8,
		isolation: "none",
		cancelOrphansOnAgentEnd: true,
		cancelOrphansOnSessionChange: true,
		maxIdleMembers: 10,
		messageRateLimitPerMinute: 30,
		messageHistoryLimit: 100,
		defaultWorkerModel: undefined,
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

	async cancel() {
		this._status = "cancelled";
	}

	dispose() {
		this._listeners.clear();
	}
}

function installFakeFactory() {
	const fakeWorkers: FakeWorker[] = [];
	let nextId = 0;
	const originalFactory = WorkerSessionPool.workerFactory;

	WorkerSessionPool.workerFactory = (async (opts: WorkerSpawnOptions) => {
		const id = `wkr_persist${nextId++}`;
		const w = new FakeWorker(id, opts.agent.name);
		fakeWorkers.push(w);
		return w as unknown as Awaited<ReturnType<typeof originalFactory>>;
	}) as typeof originalFactory;

	return {
		fakeWorkers,
		restore: () => {
			WorkerSessionPool.workerFactory = originalFactory;
		},
	};
}

let sessionIdCounter = 0;
function uniqueSessionId(): string {
	return `test-persist-${Date.now()}-${sessionIdCounter++}`;
}

describe("team persistence", () => {
	it("TeamStorage.init creates directory structure", () => {
		const sid = uniqueSessionId();
		const storage = new TeamStorage(sid);
		storage.init("/tmp");
		const dir = join(process.env.HOME ?? tmpdir(), ".config", "openagent", "teams", sid);
		expect(existsSync(dir)).toBe(true);
		expect(existsSync(join(dir, "config.json"))).toBe(true);
		expect(existsSync(join(dir, "tasks"))).toBe(true);
		expect(existsSync(join(dir, "inbox"))).toBe(true);
		storage.destroy();
	});

	it("TeamStorage saveMember / load round-trip", () => {
		const sid = uniqueSessionId();
		const storage = new TeamStorage(sid);
		storage.init("/tmp");
		storage.saveMember({
			id: "mem_test1",
			name: "alice",
			role: "researcher",
			goal: "find info",
			status: "idle",
			model: "default",
			context: [],
			turnCount: 0,
			inputTokens: 0,
			outputTokens: 0,
			cost: 0,
			lastSummary: null,
			lastError: null,
			createdAt: Date.now(),
		});
		const loaded = storage.load();
		expect(loaded).not.toBeNull();
		expect(loaded?.members.length).toBe(1);
		expect(loaded?.members[0].name).toBe("alice");
		storage.destroy();
	});

	it("TeamStorage saveTask / load round-trip", () => {
		const sid = uniqueSessionId();
		const storage = new TeamStorage(sid);
		storage.init("/tmp");
		storage.saveTask({
			id: "task_test1",
			title: "Do X",
			description: "Do something",
			status: "open",
			priority: "medium",
		});
		const loaded = storage.load();
		expect(loaded).not.toBeNull();
		expect(loaded?.tasks.length).toBe(1);
		expect(loaded?.tasks[0].title).toBe("Do X");
		storage.destroy();
	});

	it("TeamStorage appendMessage / load round-trip", () => {
		const sid = uniqueSessionId();
		const storage = new TeamStorage(sid);
		storage.init("/tmp");
		storage.saveMember({
			id: "mem_sender",
			name: "bob",
			role: "writer",
			goal: "write",
			status: "idle",
			model: "default",
			context: [],
			turnCount: 0,
			inputTokens: 0,
			outputTokens: 0,
			cost: 0,
			lastSummary: null,
			lastError: null,
			createdAt: Date.now(),
		});
		storage.saveMember({
			id: "mem_recip",
			name: "carol",
			role: "reviewer",
			goal: "review",
			status: "idle",
			model: "default",
			context: [],
			turnCount: 0,
			inputTokens: 0,
			outputTokens: 0,
			cost: 0,
			lastSummary: null,
			lastError: null,
			createdAt: Date.now(),
		});
		storage.appendMessage({
			id: "msg_test1",
			from: "mem_sender",
			to: "mem_recip",
			content: "hello",
			timestamp: Date.now(),
		});
		const loaded = storage.load();
		expect(loaded).not.toBeNull();
		expect(loaded?.messages.length).toBe(1);
		expect(loaded?.messages[0].content).toBe("hello");
		storage.destroy();
	});

	it("TeamStorage deleteMember removes member and inbox", () => {
		const sid = uniqueSessionId();
		const storage = new TeamStorage(sid);
		storage.init("/tmp");
		storage.saveMember({
			id: "mem_delme",
			name: "deleteme",
			role: "temp",
			goal: "go away",
			status: "idle",
			model: "default",
			context: [],
			turnCount: 0,
			inputTokens: 0,
			outputTokens: 0,
			cost: 0,
			lastSummary: null,
			lastError: null,
			createdAt: Date.now(),
		});
		expect(storage.load()?.members.length).toBe(1);
		storage.deleteMember("mem_delme");
		expect(storage.load()?.members.length).toBe(0);
		storage.destroy();
	});

	it("TeamStorage destroy removes directory", () => {
		const sid = uniqueSessionId();
		const storage = new TeamStorage(sid);
		storage.init("/tmp");
		const dir = join(process.env.HOME ?? tmpdir(), ".config", "openagent", "teams", sid);
		expect(existsSync(dir)).toBe(true);
		storage.destroy();
		expect(existsSync(dir)).toBe(false);
	});

	it("WorkerSessionPool with sessionId persists createMember", () => {
		const sid = uniqueSessionId();
		const { restore } = installFakeFactory();
		try {
			const pool = new WorkerSessionPool(makeConfig(), makeServices(), "/tmp", sid);
			pool.createMember({
				name: "alice",
				role: "researcher",
				goal: "find info",
			});

			const storage = new TeamStorage(sid);
			const loaded = storage.load();
			expect(loaded).not.toBeNull();
			expect(loaded?.members.length).toBe(1);
			expect(loaded?.members[0].name).toBe("alice");
			storage.destroy();
		} finally {
			restore();
		}
	});

	it("WorkerSessionPool with sessionId persists sendMessage", () => {
		const sid = uniqueSessionId();
		const { restore } = installFakeFactory();
		try {
			const pool = new WorkerSessionPool(makeConfig(), makeServices(), "/tmp", sid);
			const alice = pool.createMember({
				name: "alice",
				role: "researcher",
				goal: "find info",
			});
			const bob = pool.createMember({
				name: "bob",
				role: "writer",
				goal: "write docs",
			});
			pool.sendMessage(alice.id, bob.id, "hello bob");

			const storage = new TeamStorage(sid);
			const loaded = storage.load();
			expect(loaded).not.toBeNull();
			expect(loaded?.messages.length).toBe(1);
			expect(loaded?.messages[0].content).toBe("hello bob");
			storage.destroy();
		} finally {
			restore();
		}
	});

	it("WorkerSessionPool restores state on construction with same sessionId", async () => {
		const sid = uniqueSessionId();
		const { fakeWorkers, restore } = installFakeFactory();
		try {
			const pool1 = new WorkerSessionPool(makeConfig(), makeServices(), "/tmp", sid);
			const alice = pool1.createMember({
				name: "alice",
				role: "researcher",
				goal: "find info",
			});
			pool1.sendMessage(alice.id, "team", "first message");
			await pool1.dispose();

			const pool2 = new WorkerSessionPool(makeConfig(), makeServices(), "/tmp", sid);
			const members = pool2.listMembers();
			expect(members.length).toBe(1);
			expect(members[0].name).toBe("alice");

			const inbox = pool2.readInbox();
			expect(inbox.length).toBe(1);
			expect(inbox[0].content).toBe("first message");

			await pool2.dispose();
		} finally {
			restore();
		}
	});

	it("WorkerSessionPool without sessionId does not persist", () => {
		const { restore } = installFakeFactory();
		try {
			const pool = new WorkerSessionPool(makeConfig(), makeServices(), "/tmp");
			pool.createMember({
				name: "ghost",
				role: "ephemeral",
				goal: "disappear",
			});
			const members = pool.listMembers();
			expect(members.length).toBe(1);
			expect(members[0].name).toBe("ghost");
		} finally {
			restore();
		}
	});

	it("crash recovery: member+task state survives incomplete dispose", async () => {
		const sid = uniqueSessionId();
		const { fakeWorkers, restore } = installFakeFactory();
		try {
			const pool1 = new WorkerSessionPool(makeConfig(), makeServices(), "/tmp", sid);
			const alice = pool1.createMember({
				name: "alice",
				role: "researcher",
				goal: "find info",
			});
			pool1.assignTask({
				title: "Research X",
				description: "Find all info about X",
				memberId: alice.id,
			});
			await new Promise((r) => setTimeout(r, 50));

			// Simulate crash — no dispose, just abandon
			// The persist() calls in assignTask already wrote to disk

			const pool2 = new WorkerSessionPool(makeConfig(), makeServices(), "/tmp", sid);
			const members = pool2.listMembers();
			expect(members.length).toBe(1);
			expect(members[0].name).toBe("alice");

			const tasks = pool2.listTasks();
			expect(tasks.length).toBeGreaterThanOrEqual(1);
			expect(tasks.some((t) => t.title === "Research X")).toBe(true);

			await pool2.dispose();
		} finally {
			restore();
		}
	});

	it("removeMember deletes from persistence", () => {
		const sid = uniqueSessionId();
		const { restore } = installFakeFactory();
		try {
			const pool = new WorkerSessionPool(makeConfig(), makeServices(), "/tmp", sid);
			const alice = pool.createMember({
				name: "alice",
				role: "researcher",
				goal: "find info",
			});
			expect(pool.listMembers().length).toBe(1);
			pool.removeMember(alice.id);
			expect(pool.listMembers().length).toBe(0);

			const storage = new TeamStorage(sid);
			const loaded = storage.load();
			expect(loaded?.members.length).toBe(0);
			storage.destroy();
		} finally {
			restore();
		}
	});
});
