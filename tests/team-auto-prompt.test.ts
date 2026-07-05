/**
 * Auto-prompt e2e test — validates that when a team member completes a task
 * while the leader agent is idle (not streaming), session.prompt() is called
 * instead of session.steer(). When the leader is streaming, steer() is used.
 *
 * This tests the core auto-prompt logic from AgentServer.ensureSubscribed()
 * without requiring a real AgentSession or LLM.
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

	cancel() {
		this._status = "cancelled";
		this.emit({
			type: "team_worker_event",
			workerId: this.id,
			workerAgent: this.agent,
			kind: "cancelled",
			payload: { type: "cancelled" } as never,
		});
	}

	dispose() {
		this._listeners.clear();
	}

	private emit(event: WorkerEventEnvelope) {
		for (const l of this._listeners) l(event);
	}
}

/**
 * Mock session that tracks prompt/steer calls and supports toggling isStreaming.
 * This simulates the AgentSession interface from Pi SDK that AgentServer depends on.
 */
class MockSession {
	private _isStreaming = false;
	readonly promptCalls: string[] = [];
	readonly steerCalls: string[] = [];

	get isStreaming() {
		return this._isStreaming;
	}

	setStreaming(value: boolean) {
		this._isStreaming = value;
	}

	prompt(text: string): Promise<void> {
		this.promptCalls.push(text);
		return Promise.resolve();
	}

	steer(text: string): void {
		this.steerCalls.push(text);
	}
}

function installFakeFactory() {
	const fakeWorkers: FakeWorker[] = [];
	let nextId = 0;
	const originalFactory = WorkerSessionPool.workerFactory;

	WorkerSessionPool.workerFactory = (async (opts: WorkerSpawnOptions) => {
		const id = `wkr_ap${nextId++}`;
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

/**
 * Wire up the same callback logic that AgentServer.ensureSubscribed() uses.
 * This avoids needing to construct a full AgentServer with Pi SDK dependencies.
 */
function wireAutoPromptCallback(pool: WorkerSessionPool, session: MockSession) {
	return pool.subscribe((event: WorkerEventEnvelope) => {
		if (event.kind === "agent_end" || event.kind === "error" || event.kind === "cancelled") {
			const snap = pool.get(event.workerId);
			if (snap) {
				const isMember = pool.isTeamMember(event.workerId);
				if (isMember) {
					const member = pool.findMemberByWorkerId(event.workerId);
					const task = pool.findTaskByWorkerId(event.workerId);
					const name = member?.name ?? event.workerAgent;
					const status = member?.status ?? snap.status;
					const summary = snap.lastSummary?.slice(0, 2000) ?? "(no output)";
					const error = snap.lastError ? `\nError: ${snap.lastError}` : "";
					const costStr = snap.cost > 0 ? ` | cost $${snap.cost.toFixed(4)}` : "";
					const taskTitle = task?.title ? ` — ${task.title}` : "";
					const note = `[Team Member ${name}${taskTitle} ${status}${costStr}]\n${summary}${error}`;
					if (session.isStreaming) {
						session.steer(note);
					} else {
						void session.prompt(note);
					}
				} else {
					const status = snap.status;
					const summary = snap.lastSummary?.slice(0, 2000) ?? "(no output)";
					const error = snap.lastError ? `\nError: ${snap.lastError}` : "";
					const costStr = snap.cost > 0 ? ` | cost $${snap.cost.toFixed(4)}` : "";
					const note = `[Worker ${event.workerId.slice(0, 10)}/${event.workerAgent} ${status}${costStr}]\n${summary}${error}`;
					session.steer(note);
				}
			}
		}
	});
}

// ── Tests ──

describe("auto-prompt: leader response when member completes", () => {
	it("member completes while leader idle → prompt() called (not steer)", async () => {
		const { fakeWorkers, restore } = installFakeFactory();
		try {
			const pool = new WorkerSessionPool(makeConfig(), makeServices(), "/tmp");
			const session = new MockSession();
			session.setStreaming(false); // leader is idle
			wireAutoPromptCallback(pool, session);

			const alice = pool.createMember({ name: "alice", role: "dev", goal: "code" });
			pool.assignTask({ title: "Write tests", description: "Unit tests", memberId: alice.id });

			await new Promise((r) => setTimeout(r, 50));

			// Worker completes
			fakeWorkers[0].finish("Tests written: 10 pass, 0 fail");

			await new Promise((r) => setTimeout(r, 50));

			// Leader idle → should call prompt(), not steer()
			expect(session.promptCalls.length).toBe(1);
			expect(session.promptCalls[0]).toContain("Team Member alice");
			expect(session.promptCalls[0]).toContain("Write tests");
			expect(session.promptCalls[0]).toContain("done");
			expect(session.promptCalls[0]).toContain("Tests written");
			expect(session.steerCalls.length).toBe(0);
		} finally {
			restore();
		}
	});

	it("member completes while leader streaming → steer() called (not prompt)", async () => {
		const { fakeWorkers, restore } = installFakeFactory();
		try {
			const pool = new WorkerSessionPool(makeConfig(), makeServices(), "/tmp");
			const session = new MockSession();
			session.setStreaming(true); // leader is actively streaming
			wireAutoPromptCallback(pool, session);

			const bob = pool.createMember({ name: "bob", role: "dev", goal: "code" });
			pool.assignTask({ title: "Refactor module", description: "Clean up", memberId: bob.id });

			await new Promise((r) => setTimeout(r, 50));

			// Worker completes while leader streaming
			fakeWorkers[0].finish("Module refactored successfully");

			await new Promise((r) => setTimeout(r, 50));

			// Leader streaming → should call steer(), not prompt()
			expect(session.steerCalls.length).toBe(1);
			expect(session.steerCalls[0]).toContain("Team Member bob");
			expect(session.steerCalls[0]).toContain("Refactor module");
			expect(session.steerCalls[0]).toContain("done");
			expect(session.promptCalls.length).toBe(0);
		} finally {
			restore();
		}
	});

	it("V1 worker completes → always steer() regardless of streaming state", async () => {
		const { fakeWorkers, restore } = installFakeFactory();
		try {
			const pool = new WorkerSessionPool(makeConfig(), makeServices(), "/tmp");

			// Test with leader idle
			const sessionIdle = new MockSession();
			sessionIdle.setStreaming(false);
			wireAutoPromptCallback(pool, sessionIdle);

			// Spawn V1 worker (not a member — no createMember call)
			await pool.spawnWorker({
				agent: {
					name: "worker-v1",
					description: "test",
					systemPrompt: "",
					source: "project",
					filePath: "/tmp/test.md",
				} as AgentConfig,
				task: "Do some work",
				cwd: "/tmp",
				services: makeServices(),
			});

			await new Promise((r) => setTimeout(r, 50));

			// V1 worker completes while leader idle
			fakeWorkers[0].finish("Work done");

			await new Promise((r) => setTimeout(r, 50));

			// V1 worker → always steer(), even when leader idle
			expect(sessionIdle.steerCalls.length).toBe(1);
			expect(sessionIdle.steerCalls[0]).toContain("Worker");
			expect(sessionIdle.steerCalls[0]).not.toContain("Team Member");
			expect(sessionIdle.promptCalls.length).toBe(0);

			await pool.dispose();
		} finally {
			restore();
		}
	});

	it("member error while leader idle → prompt() called with error info", async () => {
		const { fakeWorkers, restore } = installFakeFactory();
		try {
			const pool = new WorkerSessionPool(makeConfig(), makeServices(), "/tmp");
			const session = new MockSession();
			session.setStreaming(false);
			wireAutoPromptCallback(pool, session);

			const carol = pool.createMember({ name: "carol", role: "dev", goal: "test" });
			pool.assignTask({ title: "Run tests", description: "Integration tests", memberId: carol.id });

			await new Promise((r) => setTimeout(r, 50));

			// Worker fails
			fakeWorkers[0].fail("Test suite crashed: OOM");

			await new Promise((r) => setTimeout(r, 50));

			expect(session.promptCalls.length).toBe(1);
			expect(session.promptCalls[0]).toContain("Team Member carol");
			expect(session.promptCalls[0]).toContain("error");
			expect(session.promptCalls[0]).toContain("OOM");
			expect(session.steerCalls.length).toBe(0);
		} finally {
			restore();
		}
	});

	it("member cancelled while leader idle → prompt() called", async () => {
		const { fakeWorkers, restore } = installFakeFactory();
		try {
			const pool = new WorkerSessionPool(makeConfig(), makeServices(), "/tmp");
			const session = new MockSession();
			session.setStreaming(false);
			wireAutoPromptCallback(pool, session);

			const dave = pool.createMember({ name: "dave", role: "dev", goal: "code" });
			pool.assignTask({ title: "Build feature", description: "New feature", memberId: dave.id });

			await new Promise((r) => setTimeout(r, 50));

			// Cancel the member — FakeWorker doesn't emit cancel event automatically,
			// so we manually emit it via the worker
			fakeWorkers[0].cancel();

			await new Promise((r) => setTimeout(r, 50));

			expect(session.promptCalls.length).toBe(1);
			expect(session.promptCalls[0]).toContain("Team Member dave");
		} finally {
			restore();
		}
	});

	it("multiple members complete while leader idle → prompt() called for each", async () => {
		const { fakeWorkers, restore } = installFakeFactory();
		try {
			const pool = new WorkerSessionPool(makeConfig({ maxWorkers: 4 }), makeServices(), "/tmp");
			const session = new MockSession();
			session.setStreaming(false);
			wireAutoPromptCallback(pool, session);

			const alice = pool.createMember({ name: "alice", role: "dev", goal: "code" });
			const bob = pool.createMember({ name: "bob", role: "dev", goal: "test" });
			pool.assignTask({ title: "Code", description: "Write code", memberId: alice.id });
			pool.assignTask({ title: "Test", description: "Write tests", memberId: bob.id });

			await new Promise((r) => setTimeout(r, 50));

			// Both workers finish
			fakeWorkers[0].finish("Code done");
			fakeWorkers[1].finish("Tests done");

			await new Promise((r) => setTimeout(r, 50));

			// Each completion should trigger a separate prompt()
			expect(session.promptCalls.length).toBe(2);
			const notes = session.promptCalls.join("\n");
			expect(notes).toContain("Team Member alice");
			expect(notes).toContain("Team Member bob");
		} finally {
			restore();
		}
	});

	it("member completion note includes cost when cost > 0", async () => {
		const { fakeWorkers, restore } = installFakeFactory();
		try {
			const pool = new WorkerSessionPool(makeConfig(), makeServices(), "/tmp");
			const session = new MockSession();
			session.setStreaming(false);
			wireAutoPromptCallback(pool, session);

			const eve = pool.createMember({ name: "eve", role: "analyst", goal: "analyze" });
			pool.assignTask({ title: "Big analysis", description: "Heavy compute", memberId: eve.id });

			await new Promise((r) => setTimeout(r, 50));

			// Worker finishes with cost
			fakeWorkers[0].finish("Analysis complete", 10, 5000, 2000, 0.05);

			await new Promise((r) => setTimeout(r, 50));

			expect(session.promptCalls.length).toBe(1);
			expect(session.promptCalls[0]).toContain("cost $0.0500");
		} finally {
			restore();
		}
	});

	it("member completion note omits cost when cost is 0", async () => {
		const { fakeWorkers, restore } = installFakeFactory();
		try {
			const pool = new WorkerSessionPool(makeConfig(), makeServices(), "/tmp");
			const session = new MockSession();
			session.setStreaming(false);
			wireAutoPromptCallback(pool, session);

			const frank = pool.createMember({ name: "frank", role: "dev", goal: "code" });
			pool.assignTask({ title: "Quick fix", description: "Small change", memberId: frank.id });

			await new Promise((r) => setTimeout(r, 50));

			// Worker finishes with zero cost
			fakeWorkers[0].finish("Fixed", 1, 100, 50, 0);

			await new Promise((r) => setTimeout(r, 50));

			expect(session.promptCalls.length).toBe(1);
			expect(session.promptCalls[0]).not.toContain("cost $");
		} finally {
			restore();
		}
	});
});
