import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SubagentServices } from "../src/agents/types.js";
import type {
	MemberId,
	TeamMember,
	TeamMessage,
	TeamTask,
	WorkerPoolRef,
	WorkerSnapshot,
} from "../src/teams/types.js";
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

function fakeMember(overrides: Partial<TeamMember> = {}): TeamMember {
	return {
		id: "mem_test1",
		name: "tester",
		role: "dev",
		goal: "test things",
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
		...overrides,
	};
}

function makeMinimalPool(
	overrides: Partial<WorkerPoolRef["current"]> = {},
): WorkerPoolRef["current"] {
	return {
		spawnWorker: async () => ({ workerId: "wkr_x", status: "running" as const }),
		get: () => undefined,
		list: () => [],
		runningCount: () => 0,
		cancel: async () => {},
		cancelAll: async () => {},
		dispose: async () => {},
		subscribe: () => () => {},
		createMember: () => fakeMember(),
		removeMember: () => {},
		getMember: () => undefined,
		listMembers: () => [],
		assignTask: () =>
			({
				id: "task_1",
				title: "test",
				description: "test",
				status: "in_progress",
				priority: "medium",
			}) as TeamTask,
		listTasks: () => [],
		taskStatus: () => undefined,
		sendMessage: () => {},
		readInbox: () => [],
		getWorkerForMember: () => undefined,
		cancelMember: async () => {},
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

	it("create-member requires name, role, and goal", async () => {
		const pool = makeMinimalPool();
		const tool = makeTool(tempDir, { current: pool });
		const result = await tool.execute("call-1", { action: "create-member" }, undefined as never);
		expect(result.content[0].text).toContain("name, role, and goal required");
	});

	it("create-member succeeds with valid params", async () => {
		let createdName: string | undefined;
		const pool = makeMinimalPool({
			createMember: (opts) => {
				createdName = opts.name;
				return fakeMember({ name: opts.name, role: opts.role, goal: opts.goal });
			},
		});
		const tool = makeTool(tempDir, { current: pool });
		const result = await tool.execute(
			"call-1",
			{ action: "create-member", name: "bob", role: "dev", goal: "code" },
			undefined as never,
		);
		expect(result.content[0].text).toContain("bob");
		expect(result.content[0].text).toContain("idle");
		expect(createdName).toBe("bob");
	});

	it("assign-task requires title, description, and memberId", async () => {
		const pool = makeMinimalPool();
		const tool = makeTool(tempDir, { current: pool });
		const result = await tool.execute("call-1", { action: "assign-task" }, undefined as never);
		expect(result.content[0].text).toContain("title, description, and memberId required");
	});

	it("assign-task succeeds with valid params", async () => {
		let assignedMemberId: string | undefined;
		const pool = makeMinimalPool({
			assignTask: (opts) => {
				assignedMemberId = opts.memberId;
				return {
					id: "task_1",
					title: opts.title,
					description: opts.description,
					assignedTo: opts.memberId,
					status: "in_progress",
					priority: "medium",
				} as TeamTask;
			},
		});
		const tool = makeTool(tempDir, { current: pool });
		const result = await tool.execute(
			"call-1",
			{
				action: "assign-task",
				title: "do work",
				description: "implement X",
				memberId: "mem_test1",
			},
			undefined as never,
		);
		expect(result.content[0].text).toContain("do work");
		expect(result.content[0].text).toContain("in_progress");
		expect(assignedMemberId).toBe("mem_test1");
	});

	it("poll with no members returns helpful message", async () => {
		const pool = makeMinimalPool();
		const tool = makeTool(tempDir, { current: pool });
		const result = await tool.execute("call-1", { action: "poll" }, undefined as never);
		expect(result.content[0].text).toContain("No members found");
	});

	it("poll returns worker snapshot", async () => {
		const snap = fakeSnapshot();
		const pool = makeMinimalPool({
			list: () => [snap],
			runningCount: () => 1,
		});
		const tool = makeTool(tempDir, { current: pool });
		const result = await tool.execute("call-1", { action: "poll" }, undefined as never);
		expect(result.content[0].text).toContain("[running]");
		expect(result.content[0].text).toContain("wkr_test1");
	});

	it("cancel single member calls cancelMember", async () => {
		let cancelledMemberId: string | undefined;
		const pool = makeMinimalPool({
			cancelMember: async (id) => {
				cancelledMemberId = id;
			},
		});
		const tool = makeTool(tempDir, { current: pool });
		const result = await tool.execute(
			"call-1",
			{ action: "cancel", memberId: "mem_to_cancel" },
			undefined as never,
		);
		expect(cancelledMemberId).toBe("mem_to_cancel");
		expect(result.content[0].text).toContain("cancelled");
	});

	it("cancel without memberId calls cancelAll", async () => {
		let allCancelled = false;
		const pool = makeMinimalPool({
			cancelAll: async () => {
				allCancelled = true;
			},
		});
		const tool = makeTool(tempDir, { current: pool });
		const result = await tool.execute("call-1", { action: "cancel" }, undefined as never);
		expect(allCancelled).toBe(true);
		expect(result.content[0].text).toContain("All members cancelled");
	});

	it("unknown action returns error", async () => {
		const pool = makeMinimalPool();
		const tool = makeTool(tempDir, { current: pool });
		const result = await tool.execute("call-1", { action: "foobar" }, undefined as never);
		expect(result.content[0].text).toContain("unknown action");
	});

	it("list-members returns member overview", async () => {
		const pool = makeMinimalPool({
			listMembers: () => [fakeMember({ name: "alice", role: "dev", status: "idle" })],
		});
		const tool = makeTool(tempDir, { current: pool });
		const result = await tool.execute("call-1", { action: "list-members" }, undefined as never);
		expect(result.content[0].text).toContain("alice");
		expect(result.content[0].text).toContain("[idle]");
	});

	it("list-tasks returns task overview", async () => {
		const pool = makeMinimalPool({
			listTasks: () => [
				{
					id: "task_1",
					title: "fix bug",
					description: "fix it",
					status: "done",
					priority: "high",
					assignedTo: "mem_test1",
				} as TeamTask,
			],
		});
		const tool = makeTool(tempDir, { current: pool });
		const result = await tool.execute("call-1", { action: "list-tasks" }, undefined as never);
		expect(result.content[0].text).toContain("fix bug");
		expect(result.content[0].text).toContain("[done]");
	});

	it("send-message requires memberId and content", async () => {
		const pool = makeMinimalPool();
		const tool = makeTool(tempDir, { current: pool });
		const result = await tool.execute("call-1", { action: "send-message" }, undefined as never);
		expect(result.content[0].text).toContain("memberId (from) and content required");
	});

	it("read-inbox returns messages", async () => {
		const pool = makeMinimalPool({
			readInbox: () => [
				{
					id: "msg_1",
					from: "mem_a",
					to: "mem_b" as MemberId,
					content: "hello",
					timestamp: Date.now(),
				} as TeamMessage,
			],
		});
		const tool = makeTool(tempDir, { current: pool });
		const result = await tool.execute("call-1", { action: "read-inbox" }, undefined as never);
		expect(result.content[0].text).toContain("hello");
	});
});
