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

function _makeAgent(name = "test-worker"): AgentConfig {
	return {
		name,
		description: "test",
		systemPrompt: "",
		source: "project",
		filePath: "/tmp/test.md",
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
		this.emit({
			type: "team_worker_event",
			workerId: this.id,
			workerAgent: this.agent,
			kind: "error",
			payload: { type: "error" } as never,
		});
	}

	async cancel() {
		this._status = "cancelled";
	}

	dispose() {
		this._listeners.clear();
	}
}

function installFakeFactory(): {
	fakeWorkers: FakeWorker[];
	restore: () => void;
} {
	const fakeWorkers: FakeWorker[] = [];
	let nextId = 0;
	const originalFactory = WorkerSessionPool.workerFactory;

	WorkerSessionPool.workerFactory = (async (opts: WorkerSpawnOptions) => {
		const id = `wkr_int${nextId++}`;
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

describe("team V2 integration", () => {
	it("createMember → assignTask → worker finishes → member/task status synced", async () => {
		const { fakeWorkers, restore } = installFakeFactory();
		try {
			const pool = new WorkerSessionPool(makeConfig(), makeServices(), "/tmp");

			const alice = pool.createMember({
				name: "alice",
				role: "researcher",
				goal: "find information",
			});
			expect(alice.status).toBe("idle");

			const task = pool.assignTask({
				title: "Research X",
				description: "Find all info about X",
				memberId: alice.id,
			});

			await new Promise((r) => setTimeout(r, 50));

			expect(task.status).toBe("in_progress");

			const memberAfterAssign = pool.getMember(alice.id);
			expect(memberAfterAssign?.status).toBe("working");

			expect(pool.getWorkerForMember(alice.id)).toBeDefined();

			fakeWorkers[0].finish("Found X info: ...");

			await new Promise((r) => setTimeout(r, 50));

			const memberAfterDone = pool.getMember(alice.id);
			expect(memberAfterDone?.status).toBe("done");
			expect(memberAfterDone?.lastSummary).toBe("Found X info: ...");
			expect(memberAfterDone?.turnCount).toBe(3);
			expect(memberAfterDone?.cost).toBeCloseTo(0.005);

			const taskAfterDone = pool.taskStatus(task.id);
			expect(taskAfterDone?.status).toBe("done");
			expect(taskAfterDone?.result).toBe("Found X info: ...");

			expect(pool.getWorkerForMember(alice.id)).toBeUndefined();
		} finally {
			restore();
		}
	});

	it("createMember → assignTask → cancelMember → member/task status blocked", async () => {
		const { fakeWorkers, restore } = installFakeFactory();
		try {
			const pool = new WorkerSessionPool(makeConfig(), makeServices(), "/tmp");

			const bob = pool.createMember({
				name: "bob",
				role: "writer",
				goal: "write docs",
			});

			const task = pool.assignTask({
				title: "Write docs",
				description: "Document the API",
				memberId: bob.id,
			});

			await new Promise((r) => setTimeout(r, 50));
			expect(task.status).toBe("in_progress");
			expect(pool.getMember(bob.id)?.status).toBe("working");

			await pool.cancelMember(bob.id);

			const memberAfterCancel = pool.getMember(bob.id);
			expect(memberAfterCancel?.status).toBe("idle");

			const taskAfterCancel = pool.taskStatus(task.id);
			expect(taskAfterCancel?.status).toBe("blocked");
			expect(taskAfterCancel?.blockReason).toBe("cancelled");

			expect(pool.getWorkerForMember(bob.id)).toBeUndefined();
			expect(pool.runningCount()).toBe(0);
		} finally {
			restore();
		}
	});

	it("worker error → member status error, task status blocked", async () => {
		const { fakeWorkers, restore } = installFakeFactory();
		try {
			const pool = new WorkerSessionPool(makeConfig(), makeServices(), "/tmp");

			const carol = pool.createMember({
				name: "carol",
				role: "analyst",
				goal: "analyze data",
			});

			const task = pool.assignTask({
				title: "Analyze data",
				description: "Run analysis on dataset",
				memberId: carol.id,
			});

			await new Promise((r) => setTimeout(r, 50));

			fakeWorkers[0].fail("OOM: dataset too large");

			await new Promise((r) => setTimeout(r, 50));

			const member = pool.getMember(carol.id);
			expect(member?.status).toBe("error");
			expect(member?.lastError).toBe("OOM: dataset too large");

			const taskResult = pool.taskStatus(task.id);
			expect(taskResult?.status).toBe("blocked");
			expect(taskResult?.blockReason).toBe("OOM: dataset too large");
		} finally {
			restore();
		}
	});

	it("sendMessage → readInbox returns messages for recipient", async () => {
		const pool = new WorkerSessionPool(makeConfig(), makeServices(), "/tmp");

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

		pool.sendMessage(alice.id, bob.id, "Here are the research notes.");
		pool.sendMessage(bob.id, alice.id, "Got it, drafting now.");
		pool.sendMessage(alice.id, "team", "Team broadcast: milestone reached.");

		const bobInbox = pool.readInbox(bob.id);
		expect(bobInbox.length).toBe(3);
		expect(bobInbox.some((m) => m.from === alice.id && m.content.includes("research notes"))).toBe(
			true,
		);
		expect(bobInbox.some((m) => m.from === bob.id && m.content.includes("Got it"))).toBe(true);
		expect(bobInbox.some((m) => m.to === "team")).toBe(true);

		const aliceInbox = pool.readInbox(alice.id);
		expect(aliceInbox.some((m) => m.from === bob.id && m.content.includes("Got it"))).toBe(true);
		expect(aliceInbox.some((m) => m.from === alice.id && m.to === "team")).toBe(true);

		const fullInbox = pool.readInbox();
		expect(fullInbox.length).toBe(3);
	});

	it("removeMember rejects working member, allows idle/done member", async () => {
		const { fakeWorkers, restore } = installFakeFactory();
		try {
			const pool = new WorkerSessionPool(makeConfig(), makeServices(), "/tmp");

			const idleMember = pool.createMember({
				name: "idle-guy",
				role: "observer",
				goal: "watch",
			});
			pool.removeMember(idleMember.id);
			expect(pool.getMember(idleMember.id)).toBeUndefined();

			const workerMember = pool.createMember({
				name: "worker-guy",
				role: "dev",
				goal: "code",
			});
			pool.assignTask({
				title: "Build feature",
				description: "Implement X",
				memberId: workerMember.id,
			});

			await new Promise((r) => setTimeout(r, 50));
			expect(pool.getMember(workerMember.id)?.status).toBe("working");
			expect(() => pool.removeMember(workerMember.id)).toThrow("currently working");

			fakeWorkers[0].finish("Feature built");
			await new Promise((r) => setTimeout(r, 50));

			expect(pool.getMember(workerMember.id)?.status).toBe("done");
			pool.removeMember(workerMember.id);
			expect(pool.getMember(workerMember.id)).toBeUndefined();
		} finally {
			restore();
		}
	});

	it("assignTask rejects when maxWorkers reached", async () => {
		const { fakeWorkers, restore } = installFakeFactory();
		try {
			const pool = new WorkerSessionPool(makeConfig({ maxWorkers: 2 }), makeServices(), "/tmp");

			const m1 = pool.createMember({ name: "a1", role: "r1", goal: "g1" });
			const m2 = pool.createMember({ name: "a2", role: "r2", goal: "g2" });
			pool.assignTask({ title: "t1", description: "d1", memberId: m1.id });
			pool.assignTask({ title: "t2", description: "d2", memberId: m2.id });

			await new Promise((r) => setTimeout(r, 50));
			expect(pool.runningCount()).toBe(2);

			const m3 = pool.createMember({ name: "a3", role: "r3", goal: "g3" });
			expect(() => pool.assignTask({ title: "t3", description: "d3", memberId: m3.id })).toThrow(
				"max running members",
			);
		} finally {
			restore();
		}
	});

	it("listMembers and listTasks reflect current state after full lifecycle", async () => {
		const { fakeWorkers, restore } = installFakeFactory();
		try {
			const pool = new WorkerSessionPool(makeConfig(), makeServices(), "/tmp");

			const alice = pool.createMember({ name: "alice", role: "dev", goal: "code" });
			const bob = pool.createMember({ name: "bob", role: "dev", goal: "test" });

			pool.assignTask({ title: "Code feature", description: "Implement X", memberId: alice.id });
			pool.assignTask({ title: "Test feature", description: "Verify X works", memberId: bob.id });

			await new Promise((r) => setTimeout(r, 50));

			const members = pool.listMembers();
			expect(members.length).toBe(2);
			expect(members.every((m) => m.status === "working")).toBe(true);

			const tasks = pool.listTasks();
			expect(tasks.length).toBe(2);
			expect(tasks.every((t) => t.status === "in_progress")).toBe(true);

			fakeWorkers[0].finish("Code done");
			fakeWorkers[1].fail("Test failed: assertion error");

			await new Promise((r) => setTimeout(r, 50));

			const membersAfter = pool.listMembers();
			expect(membersAfter.find((m) => m.name === "alice")?.status).toBe("done");
			expect(membersAfter.find((m) => m.name === "bob")?.status).toBe("error");

			const tasksAfter = pool.listTasks();
			expect(tasksAfter.find((t) => t.title === "Code feature")?.status).toBe("done");
			expect(tasksAfter.find((t) => t.title === "Test feature")?.status).toBe("blocked");
		} finally {
			restore();
		}
	});

	it("getWorkerForMember returns correct snapshot for working member", async () => {
		const { fakeWorkers, restore } = installFakeFactory();
		try {
			const pool = new WorkerSessionPool(makeConfig(), makeServices(), "/tmp");

			const alice = pool.createMember({ name: "alice", role: "dev", goal: "code" });
			pool.assignTask({ title: "Task A", description: "Do A", memberId: alice.id });

			await new Promise((r) => setTimeout(r, 50));

			const snap = pool.getWorkerForMember(alice.id);
			expect(snap).toBeDefined();
			expect(snap?.status).toBe("running");
			expect(snap?.agent).toBe("alice");

			fakeWorkers[0].finish("A done");
			await new Promise((r) => setTimeout(r, 50));

			expect(pool.getWorkerForMember(alice.id)).toBeUndefined();
		} finally {
			restore();
		}
	});

	it("cancelAll updates all member/task statuses", async () => {
		const { fakeWorkers, restore } = installFakeFactory();
		try {
			const pool = new WorkerSessionPool(makeConfig(), makeServices(), "/tmp");

			const m1 = pool.createMember({ name: "a", role: "r", goal: "g" });
			const m2 = pool.createMember({ name: "b", role: "r", goal: "g" });
			const t1 = pool.assignTask({ title: "t1", description: "d1", memberId: m1.id });
			const t2 = pool.assignTask({ title: "t2", description: "d2", memberId: m2.id });

			await new Promise((r) => setTimeout(r, 50));

			await pool.cancelAll();

			expect(pool.getMember(m1.id)?.status).toBe("idle");
			expect(pool.getMember(m2.id)?.status).toBe("idle");
			expect(pool.taskStatus(t1.id)?.status).toBe("blocked");
			expect(pool.taskStatus(t2.id)?.status).toBe("blocked");
			expect(pool.taskStatus(t1.id)?.blockReason).toBe("cancelled");
			expect(pool.runningCount()).toBe(0);
		} finally {
			restore();
		}
	});

	it("reassign task to done member → member goes back to working", async () => {
		const { fakeWorkers, restore } = installFakeFactory();
		try {
			const pool = new WorkerSessionPool(makeConfig(), makeServices(), "/tmp");

			const alice = pool.createMember({ name: "alice", role: "dev", goal: "code" });
			const t1 = pool.assignTask({ title: "Task 1", description: "Do 1", memberId: alice.id });

			await new Promise((r) => setTimeout(r, 50));

			fakeWorkers[0].finish("1 done");
			await new Promise((r) => setTimeout(r, 50));

			expect(pool.getMember(alice.id)?.status).toBe("done");
			expect(pool.taskStatus(t1.id)?.status).toBe("done");

			const t2 = pool.assignTask({ title: "Task 2", description: "Do 2", memberId: alice.id });

			await new Promise((r) => setTimeout(r, 50));

			expect(pool.getMember(alice.id)?.status).toBe("working");
			expect(pool.taskStatus(t2.id)?.status).toBe("in_progress");

			fakeWorkers[1].finish("2 done");
			await new Promise((r) => setTimeout(r, 50));

			expect(pool.getMember(alice.id)?.status).toBe("done");
			expect(pool.taskStatus(t2.id)?.status).toBe("done");

			const tasks = pool.listTasks();
			expect(tasks.length).toBe(2);
			expect(tasks.every((t) => t.status === "done")).toBe(true);
		} finally {
			restore();
		}
	});

	it("sendMessage truncates content exceeding 2048 chars", async () => {
		const pool = new WorkerSessionPool(makeConfig(), makeServices(), "/tmp");

		const alice = pool.createMember({ name: "alice", role: "dev", goal: "code" });
		const bob = pool.createMember({ name: "bob", role: "dev", goal: "code" });

		const longContent = "x".repeat(3000);
		pool.sendMessage(alice.id, bob.id, longContent);

		const msgs = pool.readInbox(bob.id);
		expect(msgs.length).toBe(1);
		expect(msgs[0].content.length).toBeLessThanOrEqual(2060);
		expect(msgs[0].content.endsWith("[truncated]")).toBe(true);
	});

	it("dispose clears all member/task/message state", async () => {
		const { fakeWorkers, restore } = installFakeFactory();
		try {
			const pool = new WorkerSessionPool(makeConfig(), makeServices(), "/tmp");

			const m = pool.createMember({ name: "alice", role: "dev", goal: "code" });
			pool.assignTask({ title: "Task", description: "Do it", memberId: m.id });
			pool.sendMessage(m.id, "team", "hello");

			await new Promise((r) => setTimeout(r, 50));
			await pool.dispose();

			expect(pool.listMembers()).toEqual([]);
			expect(pool.listTasks()).toEqual([]);
			expect(pool.readInbox()).toEqual([]);
		} finally {
			restore();
		}
	});

	it("findMemberByWorkerId returns member for assigned worker", async () => {
		const { fakeWorkers, restore } = installFakeFactory();
		try {
			const pool = new WorkerSessionPool(makeConfig(), makeServices(), "/tmp");
			const alice = pool.createMember({ name: "alice", role: "dev", goal: "code" });
			pool.assignTask({ title: "Task", description: "Do it", memberId: alice.id });

			await new Promise((r) => setTimeout(r, 50));
			const worker = fakeWorkers[0];
			expect(worker).toBeDefined();

			const found = pool.findMemberByWorkerId(worker.id);
			expect(found).toBeDefined();
			expect(found?.name).toBe("alice");

			expect(pool.findMemberByWorkerId("wkr_nonexistent")).toBeUndefined();
		} finally {
			restore();
		}
	});

	it("findTaskByWorkerId returns task for assigned worker", async () => {
		const { fakeWorkers, restore } = installFakeFactory();
		try {
			const pool = new WorkerSessionPool(makeConfig(), makeServices(), "/tmp");
			const alice = pool.createMember({ name: "alice", role: "dev", goal: "code" });
			pool.assignTask({ title: "Research X", description: "Find info", memberId: alice.id });

			await new Promise((r) => setTimeout(r, 50));
			const worker = fakeWorkers[0];

			const found = pool.findTaskByWorkerId(worker.id);
			expect(found).toBeDefined();
			expect(found?.title).toBe("Research X");

			expect(pool.findTaskByWorkerId("wkr_nonexistent")).toBeUndefined();
		} finally {
			restore();
		}
	});

	it("findMemberByWorkerId returns undefined after worker completes", async () => {
		const { fakeWorkers, restore } = installFakeFactory();
		try {
			const pool = new WorkerSessionPool(makeConfig(), makeServices(), "/tmp");
			const alice = pool.createMember({ name: "alice", role: "dev", goal: "code" });
			pool.assignTask({ title: "Task", description: "Do it", memberId: alice.id });

			await new Promise((r) => setTimeout(r, 50));
			const worker = fakeWorkers[0];
			worker.finish("done!");

			expect(pool.findMemberByWorkerId(worker.id)).toBeUndefined();
			expect(pool.findTaskByWorkerId(worker.id)).toBeUndefined();
		} finally {
			restore();
		}
	});

	it("leader receives steer notification when member completes task", async () => {
		const { fakeWorkers, restore } = installFakeFactory();
		try {
			const pool = new WorkerSessionPool(makeConfig(), makeServices(), "/tmp");

			const steeredEvents: string[] = [];
			pool.subscribe((event) => {
				if (event.kind === "agent_end" || event.kind === "error" || event.kind === "cancelled") {
					const snap = pool.get(event.workerId);
					if (snap) {
						const member = pool.findMemberByWorkerId(event.workerId);
						const task = pool.findTaskByWorkerId(event.workerId);
						const name = member?.name ?? event.workerAgent;
						const status = member?.status ?? snap.status;
						const taskTitle = task?.title ? ` — ${task.title}` : "";
						const note = `[Team Member ${name}${taskTitle} ${status}]`;
						steeredEvents.push(note);
					}
				}
			});

			const alice = pool.createMember({ name: "alice", role: "dev", goal: "code" });
			pool.assignTask({ title: "Write tests", description: "Write unit tests", memberId: alice.id });

			await new Promise((r) => setTimeout(r, 50));
			fakeWorkers[0].finish("Tests written successfully");

			expect(steeredEvents.length).toBeGreaterThanOrEqual(1);
			expect(steeredEvents[0]).toContain("alice");
			expect(steeredEvents[0]).toContain("Write tests");
			expect(steeredEvents[0]).toContain("done");
		} finally {
			restore();
		}
	});
});
