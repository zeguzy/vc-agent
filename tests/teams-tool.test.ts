import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SubagentServices } from "../src/agents/types.js";
import type { WorkerPoolRef, WorkerSnapshot, WorkerSpawnOptions } from "../src/teams/types.js";
import { createTeamTool } from "../src/tools/team.js";

function makeServices(): SubagentServices {
	return {
		authStorage: {} as never,
		modelRegistry: { getAll: () => [] } as never,
		settingsManager: {} as never,
	};
}

function fakeSnapshot(overrides: Partial<WorkerSnapshot> = {}): WorkerSnapshot {
	return {
		id: "wkr_test1",
		agent: "test-worker",
		status: "running",
		turnCount: 1,
		inputTokens: 100,
		outputTokens: 50,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		cost: 0.001,
		lastSummary: "Hello from worker",
		lastError: null,
		createdAt: Date.now(),
		...overrides,
	};
}

function makeAgentMd(name: string, frontmatter: string) {
	return `---\nname: ${name}\ndescription: test agent\n${frontmatter}\n---\nSystem prompt for ${name}.\n`;
}

let tempDir: string;
let agentsDir: string;

beforeEach(() => {
	tempDir = mkdtempSync(join(tmpdir(), "openagent-team-test-"));
	agentsDir = join(tempDir, ".openagent", "agents");
	mkdirSync(agentsDir, { recursive: true });
});

afterEach(() => {
	tempDir = "";
});

function makeTool(cwd: string, poolRef: WorkerPoolRef = { current: null }) {
	return createTeamTool({
		poolRef,
		cwd,
		services: makeServices(),
	});
}

describe("team tool", () => {
	it("returns error when poolRef.current is null", async () => {
		const tool = makeTool(tempDir);
		const result = await tool.execute("call-1", { action: "poll" }, undefined as never);
		expect(result.content[0].text).toContain("teams not initialized yet");
	});

	it("spawn requires agent and task", async () => {
		const tool = makeTool(tempDir, { current: null });
		const result = await tool.execute("call-1", { action: "spawn" }, undefined as never);
		expect(result.content[0].text).toContain("teams not initialized yet");
	});

	it("spawn errors on unknown agent", async () => {
		writeFileSync(
			join(agentsDir, "test-worker.md"),
			makeAgentMd("test-worker", "background: true\n"),
		);
		const spawns: WorkerSpawnOptions[] = [];
		const poolRef: WorkerPoolRef = {
			current: {
				spawnWorker: async (opts) => {
					spawns.push(opts);
					return { workerId: "wkr_new", status: "running" as const };
				},
				get: () => undefined,
				list: () => [],
				runningCount: () => 0,
				cancel: async () => {},
				cancelAll: async () => {},
				dispose: async () => {},
				subscribe: () => () => {},
			},
		};

		const tool = makeTool(tempDir, poolRef);
		const result = await tool.execute(
			"call-1",
			{ action: "spawn", agent: "nonexistent", task: "do thing" },
			undefined as never,
		);
		expect(result.content[0].text).toContain("not found");
	});

	it("spawn errors on background:false agent", async () => {
		writeFileSync(join(agentsDir, "fg-agent.md"), makeAgentMd("fg-agent", "background: false\n"));
		const poolRef: WorkerPoolRef = {
			current: {
				spawnWorker: async () => ({ workerId: "wkr_new", status: "running" as const }),
				get: () => undefined,
				list: () => [],
				runningCount: () => 0,
				cancel: async () => {},
				cancelAll: async () => {},
				dispose: async () => {},
				subscribe: () => () => {},
			},
		};

		const tool = makeTool(tempDir, poolRef);
		const result = await tool.execute(
			"call-1",
			{ action: "spawn", agent: "fg-agent", task: "do thing" },
			undefined as never,
		);
		expect(result.content[0].text).toContain("background:false");
	});

	it("spawn succeeds with valid agent", async () => {
		writeFileSync(join(agentsDir, "bg-agent.md"), makeAgentMd("bg-agent", "background: true\n"));
		const spawns: WorkerSpawnOptions[] = [];
		const poolRef: WorkerPoolRef = {
			current: {
				spawnWorker: async (opts) => {
					spawns.push(opts);
					return { workerId: "wkr_new", status: "running" as const };
				},
				get: () => undefined,
				list: () => [],
				runningCount: () => 0,
				cancel: async () => {},
				cancelAll: async () => {},
				dispose: async () => {},
				subscribe: () => () => {},
			},
		};

		const tool = makeTool(tempDir, poolRef);
		const result = await tool.execute(
			"call-1",
			{ action: "spawn", agent: "bg-agent", task: "do thing" },
			undefined as never,
		);
		expect(result.content[0].text).toContain("wkr_new");
		expect(result.content[0].text).toContain("running");
		expect(spawns).toHaveLength(1);
		expect(spawns[0].task).toBe("do thing");
		expect(spawns[0].agent.name).toBe("bg-agent");
	});

	it("poll with no workers returns helpful message", async () => {
		const poolRef: WorkerPoolRef = {
			current: {
				spawnWorker: async () => ({ workerId: "wkr_x", status: "running" as const }),
				get: () => undefined,
				list: () => [],
				runningCount: () => 0,
				cancel: async () => {},
				cancelAll: async () => {},
				dispose: async () => {},
				subscribe: () => () => {},
			},
		};

		const tool = makeTool(tempDir, poolRef);
		const result = await tool.execute("call-1", { action: "poll" }, undefined as never);
		expect(result.content[0].text).toContain("No workers found");
	});

	it("poll returns worker snapshot", async () => {
		const snap = fakeSnapshot();
		const poolRef: WorkerPoolRef = {
			current: {
				spawnWorker: async () => ({ workerId: "wkr_x", status: "running" as const }),
				get: () => snap,
				list: () => [snap],
				runningCount: () => 1,
				cancel: async () => {},
				cancelAll: async () => {},
				dispose: async () => {},
				subscribe: () => () => {},
			},
		};

		const tool = makeTool(tempDir, poolRef);
		const result = await tool.execute("call-1", { action: "poll" }, undefined as never);
		expect(result.content[0].text).toContain("[running]");
		expect(result.content[0].text).toContain("wkr_test1");
	});

	it("cancel single worker calls pool.cancel", async () => {
		let cancelled: string | undefined;
		const poolRef: WorkerPoolRef = {
			current: {
				spawnWorker: async () => ({ workerId: "wkr_x", status: "running" as const }),
				get: () => undefined,
				list: () => [],
				runningCount: () => 0,
				cancel: async (id) => {
					cancelled = id;
				},
				cancelAll: async () => {},
				dispose: async () => {},
				subscribe: () => () => {},
			},
		};

		const tool = makeTool(tempDir, poolRef);
		const result = await tool.execute(
			"call-1",
			{ action: "cancel", workerId: "wkr_to_cancel" },
			undefined as never,
		);
		expect(cancelled).toBe("wkr_to_cancel");
		expect(result.content[0].text).toContain("cancelled");
	});

	it("cancel without workerId calls cancelAll", async () => {
		let allCancelled = false;
		const poolRef: WorkerPoolRef = {
			current: {
				spawnWorker: async () => ({ workerId: "wkr_x", status: "running" as const }),
				get: () => undefined,
				list: () => [],
				runningCount: () => 0,
				cancel: async () => {},
				cancelAll: async () => {
					allCancelled = true;
				},
				dispose: async () => {},
				subscribe: () => () => {},
			},
		};

		const tool = makeTool(tempDir, poolRef);
		const result = await tool.execute("call-1", { action: "cancel" }, undefined as never);
		expect(allCancelled).toBe(true);
		expect(result.content[0].text).toContain("All workers cancelled");
	});
});
