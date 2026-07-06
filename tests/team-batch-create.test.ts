import { describe, expect, it } from "bun:test";
import type { MemberState, TaskState, TeamManagerLike } from "../src/teams/types-v2.js";
import { CREATE_BATCH_SOFT_LIMIT, createTeamTool } from "../src/tools/team.js";

type MemberInput = {
	name: string;
	role: string;
	goal: string;
	model?: string;
	services: unknown;
	parentModel?: unknown;
};
type AssignInput = {
	title: string;
	description: string;
	memberName: string;
	priority?: "high" | "medium" | "low";
};

type MockManager = TeamManagerLike & {
	createCalls: MemberInput[];
	assignCalls: AssignInput[];
};

function createMockManager(opts: {
	existingCount?: number;
	maxWorkers?: number;
	createImpl?: (m: MemberInput) => MemberState | Promise<MemberState>;
	assignImpl?: (t: AssignInput) => TaskState;
}): MockManager {
	const createCalls: MemberInput[] = [];
	const assignCalls: AssignInput[] = [];
	const existingCount = opts.existingCount ?? 0;
	const maxWorkers = opts.maxWorkers ?? 4;

	const listMembers = (): MemberState[] =>
		Array.from({ length: existingCount }, (_, i) => ({
			name: `existing-${i}`,
			role: "x",
			goal: "x",
			status: "idle" as const,
			session: {} as never,
			currentTaskId: null,
			lastTaskPrompt: null,
		}));

	const createMember = async (input: MemberInput): Promise<MemberState> => {
		createCalls.push(input);
		if (opts.createImpl) return opts.createImpl(input);
		return {
			name: input.name,
			role: input.role,
			goal: input.goal,
			status: "idle",
			session: {} as never,
			currentTaskId: null,
			lastTaskPrompt: null,
		};
	};

	const assignTask = (input: AssignInput): TaskState => {
		assignCalls.push(input);
		if (opts.assignImpl) return opts.assignImpl(input);
		return {
			id: `T${assignCalls.length}`,
			title: input.title,
			description: input.description,
			memberName: input.memberName,
			priority: input.priority ?? "medium",
			done: false,
		};
	};

	// TeamManagerLike 其他方法测试不调用，用 stub 满足接口形状
	const stub = () => {
		throw new Error("not used in this test");
	};

	return {
		createMember,
		assignTask,
		listMembers,
		getMaxWorkers: () => maxWorkers,
		removeMember: stub,
		getMember: () => undefined,
		completeTask: stub,
		listTasks: () => [],
		writeMemory: stub,
		readMemberIndex: () => null,
		readTopicFile: () => null,
		readTeamMd: () => ({
			mission: "",
			members: [],
			activeTasks: [],
			importantNotes: "",
			sharedMemoryIndex: [],
		}),
		pauseMember: stub,
		resumeMember: stub,
		cancelMember: stub,
		directMember: stub,
		isSelfMember: () => false,
		getSelfMemberName: () => undefined,
		dispose: async () => {},
		subscribe: () => () => {},
		createCalls,
		assignCalls,
	} as unknown as MockManager;
}

function buildTool(manager: MockManager) {
	const tool = createTeamTool({ teamRef: { current: manager } });
	return tool;
}

async function batch(
	manager: MockManager,
	params: Record<string, unknown>,
): Promise<{ text: string; isError: boolean }> {
	const tool = buildTool(manager);
	const res = await tool.execute(
		"test-id",
		params,
		undefined as never,
		undefined as never,
		undefined as never,
	);
	const first = res.content[0] as { text: string };
	return { text: first.text, isError: res.isError === true };
}

describe("team tool — create-batch", () => {
	it("creates all members and assigns tasks for those with taskTitle", async () => {
		const m = createMockManager({});
		const { text, isError } = await batch(m, {
			action: "create-batch",
			members: [
				{
					name: "alice",
					role: "frontend",
					goal: "UI",
					taskTitle: "Login",
					taskDescription: "build form",
				},
				{ name: "bob", role: "backend", goal: "API" },
			],
		});

		expect(isError).toBe(false);
		expect(text).toContain("Created 2 member(s):");
		expect(text).toContain("✓ alice (frontend) [T1]");
		expect(text).toContain("✓ bob (backend) — no task");
		expect(m.createCalls).toHaveLength(2);
		expect(m.assignCalls).toHaveLength(1);
		expect(m.assignCalls[0].title).toBe("Login");
	});

	it("rejects the whole batch when capacity exceeded, without calling createMember", async () => {
		const m = createMockManager({ existingCount: 3, maxWorkers: 5 });
		const { text, isError } = await batch(m, {
			action: "create-batch",
			members: [
				{ name: "a", role: "r", goal: "g" },
				{ name: "b", role: "r", goal: "g" },
				{ name: "c", role: "r", goal: "g" },
			],
		});

		expect(isError).toBe(true);
		expect(text).toContain("Batch rejected: capacity exceeded.");
		expect(text).toContain("Current members: 3");
		expect(text).toContain("Batch size: 3");
		expect(text).toContain("maxWorkers: 5");
		expect(m.createCalls).toHaveLength(0);
	});

	it("isolates per-member createMember failures and reports succeeded + failed separately", async () => {
		const m = createMockManager({
			createImpl: (input) => {
				if (input.name === "bob") throw new Error(`member "bob" already exists`);
				return {
					name: input.name,
					role: input.role,
					goal: input.goal,
					status: "idle" as const,
					session: {} as never,
					currentTaskId: null,
					lastTaskPrompt: null,
				};
			},
		});

		const { text, isError } = await batch(m, {
			action: "create-batch",
			members: [
				{ name: "alice", role: "frontend", goal: "UI" },
				{ name: "bob", role: "backend", goal: "API" },
				{ name: "carol", role: "qa", goal: "tests" },
			],
		});

		expect(isError).toBe(false);
		expect(text).toContain("Created 2 member(s):");
		expect(text).toContain("✓ alice (frontend) — no task");
		expect(text).toContain("✓ carol (qa) — no task");
		expect(text).toContain("Failed 1 member(s):");
		expect(text).toContain('✗ bob: member "bob" already exists');
		expect(m.createCalls).toHaveLength(3);
	});

	it("buckets createMember-success-but-assignTask-failure as succeeded with warn (not failed)", async () => {
		const m = createMockManager({
			assignImpl: () => {
				throw new Error("session not idle");
			},
		});

		const { text, isError } = await batch(m, {
			action: "create-batch",
			members: [
				{ name: "alice", role: "frontend", goal: "UI", taskTitle: "Login", taskDescription: "..." },
				{ name: "bob", role: "backend", goal: "API" },
			],
		});

		expect(isError).toBe(false);
		expect(text).toContain("Created 2 member(s):");
		expect(text).toContain("✓ alice (frontend) — task error: session not idle");
		expect(text).toContain("✓ bob (backend) — no task");
		expect(text).not.toContain("[T");
		expect(text).not.toContain("Failed");
		expect(m.createCalls).toHaveLength(2);
		expect(m.assignCalls).toHaveLength(1);
	});

	it("returns err when members array is missing", async () => {
		const m = createMockManager({});
		const { text, isError } = await batch(m, { action: "create-batch" });

		expect(isError).toBe(true);
		expect(text).toContain("members array is required and must not be empty");
		expect(m.createCalls).toHaveLength(0);
	});

	it("returns err when members array is empty", async () => {
		const m = createMockManager({});
		const { text, isError } = await batch(m, { action: "create-batch", members: [] });

		expect(isError).toBe(true);
		expect(text).toContain("members array is required and must not be empty");
		expect(m.createCalls).toHaveLength(0);
	});

	it("returns err when batch size exceeds soft limit", async () => {
		const m = createMockManager({ maxWorkers: 1000 });
		const oversized = Array.from({ length: CREATE_BATCH_SOFT_LIMIT + 1 }, (_, i) => ({
			name: `m${i}`,
			role: "r",
			goal: "g",
		}));
		const { text, isError } = await batch(m, { action: "create-batch", members: oversized });

		expect(isError).toBe(true);
		expect(text).toContain("exceeds soft limit");
		expect(text).toContain(String(CREATE_BATCH_SOFT_LIMIT));
		expect(m.createCalls).toHaveLength(0);
	});

	it("marks the result as isError only when all members fail", async () => {
		const m = createMockManager({
			createImpl: () => {
				throw new Error("boom");
			},
		});
		const { text, isError } = await batch(m, {
			action: "create-batch",
			members: [
				{ name: "a", role: "r", goal: "g" },
				{ name: "b", role: "r", goal: "g" },
			],
		});

		expect(isError).toBe(true);
		expect(text).toContain("Created 0 member(s):");
		expect(text).toContain("Failed 2 member(s):");
		expect(text).toContain("✗ a: boom");
		expect(text).toContain("✗ b: boom");
	});
});

describe("team tool — create (single, backward compat)", () => {
	it("still creates a single member via action=create without touching members field", async () => {
		const m = createMockManager({});
		const tool = buildTool(m);
		const res = await tool.execute(
			"test-id",
			{ action: "create", name: "solo", role: "dev", goal: "ship" },
			undefined as never,
			undefined as never,
			undefined as never,
		);
		const first = res.content[0] as { text: string };

		expect(res.isError).not.toBe(true);
		expect(first.text).toContain('Member "solo" (dev) created');
		expect(m.createCalls).toHaveLength(1);
		expect(m.createCalls[0].name).toBe("solo");
		expect(m.assignCalls).toHaveLength(0);
	});
});
