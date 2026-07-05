/**
 * Team mode end-to-end test — exercises the full leader→member workflow
 * through the `team` tool interface with a real WorkerSessionPool
 * (fake worker factory, no real LLM needed).
 */
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
import { createTeamTool } from "../src/tools/team.js";

// ── Helpers ──

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

	private emit(event: WorkerEventEnvelope) {
		for (const l of this._listeners) l(event);
	}
}

function setupPoolWithFakes(configOverrides: Partial<ResolvedTeamConfig> = {}) {
	const fakeWorkers: FakeWorker[] = [];
	let nextId = 0;
	const originalFactory = WorkerSessionPool.workerFactory;

	WorkerSessionPool.workerFactory = (async (opts: WorkerSpawnOptions) => {
		const id = `wkr_e2e${nextId++}`;
		const w = new FakeWorker(id, opts.agent.name);
		fakeWorkers.push(w);
		return w as unknown as Awaited<ReturnType<typeof originalFactory>>;
	}) as typeof originalFactory;

	const pool = new WorkerSessionPool(makeConfig(configOverrides), makeServices(), "/tmp");
	const poolRef = { current: pool as never };

	return {
		fakeWorkers,
		pool,
		poolRef,
		restore: () => {
			WorkerSessionPool.workerFactory = originalFactory;
		},
	};
}

function makeTool(poolRef: { current: unknown }) {
	return createTeamTool({
		poolRef: poolRef as never,
		cwd: "/tmp",
		services: makeServices(),
	});
}

async function exec(
	tool: ReturnType<typeof makeTool>,
	action: string,
	params: Record<string, unknown> = {},
) {
	const result = await tool.execute("call-1", { action, ...params }, undefined as never);
	const text = result.content[0].text;
	return text;
}

function extractMemberId(createOutput: string): string | undefined {
	const match = createOutput.match(/\(mem_\w+\)/);
	return match ? match[0].slice(1, -1) : undefined;
}

function extractTaskId(assignOutput: string): string | undefined {
	const match = assignOutput.match(/\(task_\w+\)/);
	return match ? match[0].slice(1, -1) : undefined;
}

// ── Tests ──

describe("team e2e — full leader→member workflow", () => {
	it("create member → assign task → poll (wait) → see result in task-status", async () => {
		const { fakeWorkers, poolRef, restore } = setupPoolWithFakes();
		try {
			const tool = makeTool(poolRef);

			// 1. Create member
			const createOut = await exec(tool, "create-member", {
				name: "alice",
				role: "researcher",
				goal: "find information",
			});
			expect(createOut).toContain("alice");
			expect(createOut).toContain("idle");
			const memberId = extractMemberId(createOut);
			expect(memberId).toBeDefined();

			// 2. Assign task
			const assignOut = await exec(tool, "assign-task", {
				title: "Research X",
				description: "Find all info about X",
				memberId,
			});
			expect(assignOut).toContain("Research X");
			expect(assignOut).toContain("in_progress");

			await new Promise((r) => setTimeout(r, 50));

			// 3. Worker finishes
			fakeWorkers[0].finish("Found X: it is a cross-platform framework.");

			await new Promise((r) => setTimeout(r, 50));

			// 4. Poll should show the member is done
			const pollOut = await exec(tool, "poll", { memberId });
			expect(pollOut).toContain("done");

			// 5. task-status should contain the result
			const taskId = extractTaskId(assignOut);
			expect(taskId).toBeDefined();
			const statusOut = await exec(tool, "task-status", { taskId });
			expect(statusOut).toContain("done");
			expect(statusOut).toContain("Found X");
		} finally {
			restore();
		}
	});

	it("poll without memberId shows all workers including finished ones", async () => {
		const { fakeWorkers, poolRef, restore } = setupPoolWithFakes();
		try {
			const tool = makeTool(poolRef);

			await exec(tool, "create-member", { name: "bob", role: "dev", goal: "code" });
			const bobMemberId = extractMemberId(
				await exec(tool, "create-member", { name: "bob", role: "dev", goal: "code" }),
			);

			// Create a second member
			await exec(tool, "create-member", { name: "carol", role: "dev", goal: "test" });

			// Assign task to first
			const assignOut = await exec(tool, "assign-task", {
				title: "Code feature",
				description: "Implement X",
				memberId: bobMemberId ?? "unknown",
			});
			expect(assignOut).toContain("in_progress");

			await new Promise((r) => setTimeout(r, 50));

			// Poll without memberId
			const pollOut = await exec(tool, "poll");
			expect(pollOut).toContain("running");

			// Worker finishes
			fakeWorkers[0].finish("Feature implemented.");
			await new Promise((r) => setTimeout(r, 50));

			const pollAfter = await exec(tool, "poll");
			expect(pollAfter).toContain("done");
		} finally {
			restore();
		}
	});

	it("list-members shows member status after worker finishes", async () => {
		const { fakeWorkers, poolRef, restore } = setupPoolWithFakes();
		try {
			const tool = makeTool(poolRef);

			const createOut = await exec(tool, "create-member", {
				name: "dave",
				role: "analyst",
				goal: "analyze data",
			});
			const memberId = extractMemberId(createOut);

			await exec(tool, "assign-task", {
				title: "Analyze",
				description: "Analyze dataset",
				memberId: memberId!,
			});

			await new Promise((r) => setTimeout(r, 50));

			const listWorking = await exec(tool, "list-members");
			expect(listWorking).toContain("working");

			fakeWorkers[0].finish("Analysis complete: 42% positive.");
			await new Promise((r) => setTimeout(r, 50));

			const listDone = await exec(tool, "list-members");
			expect(listDone).toContain("done");
		} finally {
			restore();
		}
	});

	it("member error → task blocked → leader sees error info", async () => {
		const { fakeWorkers, poolRef, restore } = setupPoolWithFakes();
		try {
			const tool = makeTool(poolRef);

			const createOut = await exec(tool, "create-member", {
				name: "eve",
				role: "tester",
				goal: "test feature",
			});
			const memberId = extractMemberId(createOut);

			const assignOut = await exec(tool, "assign-task", {
				title: "Test feature",
				description: "Verify X works",
				memberId: memberId!,
			});
			const taskId = extractTaskId(assignOut);

			await new Promise((r) => setTimeout(r, 50));

			fakeWorkers[0].fail("Test failed: assertion error on line 42");
			await new Promise((r) => setTimeout(r, 50));

			const statusOut = await exec(tool, "task-status", { taskId });
			expect(statusOut).toContain("blocked");
			expect(statusOut).toContain("assertion error");
		} finally {
			restore();
		}
	});

	it("cancel member → task blocked → list shows idle member", async () => {
		const { poolRef, restore } = setupPoolWithFakes();
		try {
			const tool = makeTool(poolRef);

			const createOut = await exec(tool, "create-member", {
				name: "frank",
				role: "writer",
				goal: "write docs",
			});
			const memberId = extractMemberId(createOut);

			const assignOut = await exec(tool, "assign-task", {
				title: "Write docs",
				description: "Document the API",
				memberId: memberId!,
			});
			const taskId = extractTaskId(assignOut);

			await new Promise((r) => setTimeout(r, 50));

			const cancelOut = await exec(tool, "cancel", { memberId });
			expect(cancelOut).toContain("cancelled");

			const listOut = await exec(tool, "list-members");
			expect(listOut).toContain("idle");

			const statusOut = await exec(tool, "task-status", { taskId });
			expect(statusOut).toContain("blocked");
			expect(statusOut).toContain("cancelled");
		} finally {
			restore();
		}
	});

	it("send-message + read-inbox between members", async () => {
		const { poolRef, restore } = setupPoolWithFakes();
		try {
			const tool = makeTool(poolRef);

			const aliceOut = await exec(tool, "create-member", {
				name: "alice",
				role: "researcher",
				goal: "research",
			});
			const aliceId = extractMemberId(aliceOut);

			const bobOut = await exec(tool, "create-member", {
				name: "bob",
				role: "writer",
				goal: "write",
			});
			const bobId = extractMemberId(bobOut);

			await exec(tool, "send-message", {
				memberId: aliceId,
				to: bobId,
				content: "Research notes ready.",
			});

			const inboxOut = await exec(tool, "read-inbox", { memberId: bobId });
			expect(inboxOut).toContain("Research notes ready.");
		} finally {
			restore();
		}
	});

	it("full lifecycle: create → assign → finish → poll → task-status → reassign → finish", async () => {
		const { fakeWorkers, poolRef, restore } = setupPoolWithFakes();
		try {
			const tool = makeTool(poolRef);

			// Create member
			const createOut = await exec(tool, "create-member", {
				name: "grace",
				role: "dev",
				goal: "build features",
			});
			const memberId = extractMemberId(createOut);

			// First task
			const assign1 = await exec(tool, "assign-task", {
				title: "Build v1",
				description: "Implement feature v1",
				memberId: memberId!,
			});
			const task1Id = extractTaskId(assign1);

			await new Promise((r) => setTimeout(r, 50));

			fakeWorkers[0].finish("v1 built successfully.");
			await new Promise((r) => setTimeout(r, 50));

			// Verify first task done
			const status1 = await exec(tool, "task-status", { taskId: task1Id });
			expect(status1).toContain("done");
			expect(status1).toContain("v1 built");

			// Member should be done now — reassign
			const assign2 = await exec(tool, "assign-task", {
				title: "Build v2",
				description: "Enhance feature v2",
				memberId: memberId!,
			});
			const task2Id = extractTaskId(assign2);

			await new Promise((r) => setTimeout(r, 50));

			fakeWorkers[1].finish("v2 built with improvements.");
			await new Promise((r) => setTimeout(r, 50));

			const status2 = await exec(tool, "task-status", { taskId: task2Id });
			expect(status2).toContain("done");
			expect(status2).toContain("v2 built");

			// Both tasks should show in list-tasks
			const listOut = await exec(tool, "list-tasks");
			expect(listOut).toContain("Build v1");
			expect(listOut).toContain("Build v2");
		} finally {
			restore();
		}
	});

	it("list-members shows costs after member finishes", async () => {
		const { fakeWorkers, poolRef, restore } = setupPoolWithFakes();
		try {
			const tool = makeTool(poolRef);

			const createOut = await exec(tool, "create-member", {
				name: "heidi",
				role: "analyst",
				goal: "analyze",
			});
			const memberId = extractMemberId(createOut);

			await exec(tool, "assign-task", {
				title: "Big analysis",
				description: "Run heavy analysis",
				memberId: memberId!,
			});

			await new Promise((r) => setTimeout(r, 50));

			fakeWorkers[0].finish("Analysis done.", 10, 5000, 2000, 0.05);
			await new Promise((r) => setTimeout(r, 50));

			const listOut = await exec(tool, "list-members");
			expect(listOut).toContain("done");
			expect(listOut).toContain("0.0500");
		} finally {
			restore();
		}
	});

	it("cancel all → all members idle, all tasks blocked", async () => {
		const { poolRef, restore } = setupPoolWithFakes();
		try {
			const tool = makeTool(poolRef);

			const m1 = await exec(tool, "create-member", { name: "a", role: "r", goal: "g" });
			const m2 = await exec(tool, "create-member", { name: "b", role: "r", goal: "g" });
			const id1 = extractMemberId(m1);
			const id2 = extractMemberId(m2);

			await exec(tool, "assign-task", { title: "t1", description: "d1", memberId: id1! });
			await exec(tool, "assign-task", { title: "t2", description: "d2", memberId: id2! });

			await new Promise((r) => setTimeout(r, 50));

			const cancelOut = await exec(tool, "cancel");
			expect(cancelOut).toContain("All members cancelled");

			const listOut = await exec(tool, "list-members");
			expect(listOut).toContain("idle");

			const tasksOut = await exec(tool, "list-tasks");
			expect(tasksOut).toContain("blocked");
		} finally {
			restore();
		}
	});
});
