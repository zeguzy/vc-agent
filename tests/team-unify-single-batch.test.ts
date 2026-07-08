import { describe, expect, it } from "bun:test";
import type { MemberState, TaskState, TeamManagerLike } from "../src/teams/types-v2.js";
import { createTeamTool } from "../src/tools/team.js";

type MemberInput = {
	name: string;
	role: string;
	goal: string;
	constraints?: string;
	model?: string;
	services: unknown;
	parentModel?: unknown;
	tools?: string[];
	skills?: string[];
	mcps?: string[];
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
	directCalls: Array<{ name: string; kind: string; payload: string }>;
};

function createMockManager(
	opts: {
		existingCount?: number;
		maxWorkers?: number;
		createImpl?: (m: MemberInput) => MemberState | Promise<MemberState>;
		assignImpl?: (t: AssignInput) => TaskState;
		directImpl?: (m: { name: string; kind: string; payload: string }) => void;
	} = {},
): MockManager {
	const createCalls: MemberInput[] = [];
	const assignCalls: AssignInput[] = [];
	const directCalls: Array<{ name: string; kind: string; payload: string }> = [];
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
			status: "active",
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

	const directMember = (name: string, kind: string, payload: string): void => {
		directCalls.push({ name, kind, payload });
		if (opts.directImpl) opts.directImpl({ name, kind, payload });
	};

	const stub = () => {
		throw new Error("not used in this test");
	};

	return {
		createMember,
		assignTask,
		directMember,
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
		isSelfMember: () => false,
		getSelfMemberName: () => undefined,
		dispose: async () => {},
		subscribe: () => () => {},
		createCalls,
		assignCalls,
		directCalls,
	} as unknown as MockManager;
}

function buildTool(manager: MockManager) {
	return createTeamTool({ teamRef: { current: manager } });
}

async function run(
	manager: MockManager,
	params: Record<string, unknown>,
): Promise<{ text: string; isError: boolean }> {
	const tool = buildTool(manager);
	const res = await tool.execute("test-id", params, undefined, undefined, undefined);
	const first = res.content[0] as { text: string };
	return { text: first.text, isError: res.isError === true };
}

describe("team tool — single action 返回格式锁定", () => {
	it("create 无任务返回单行格式", async () => {
		const m = createMockManager();
		const r = await run(m, { action: "create", name: "sasha", role: "dev", goal: "x" });
		expect(r.isError).toBe(false);
		expect(r.text).toBe('Member "sasha" (dev) created. Status: active');
	});

	it("create 有任务全成功返回单行格式含 taskId", async () => {
		const m = createMockManager();
		const r = await run(m, {
			action: "create",
			name: "sasha",
			role: "dev",
			goal: "x",
			taskTitle: "Login",
			taskDescription: "build it",
		});
		expect(r.isError).toBe(false);
		expect(r.text).toBe('Member "sasha" (dev) created and working on "Login" [T1]. Status: active');
	});

	it("create 缺 name 返回原字面量", async () => {
		const m = createMockManager();
		const r = await run(m, { action: "create", role: "dev", goal: "x" });
		expect(r.isError).toBe(true);
		expect(r.text).toBe("Error: name is required for create");
	});

	it("create 缺 role 返回原字面量", async () => {
		const m = createMockManager();
		const r = await run(m, { action: "create", name: "x", goal: "g" });
		expect(r.isError).toBe(true);
		expect(r.text).toBe("Error: role is required for create");
	});

	it("create 缺 goal 返回原字面量", async () => {
		const m = createMockManager();
		const r = await run(m, { action: "create", name: "x", role: "r" });
		expect(r.isError).toBe(true);
		expect(r.text).toBe("Error: goal is required for create");
	});

	it("assign 返回单行格式", async () => {
		const m = createMockManager();
		const r = await run(m, { action: "assign", name: "x", title: "do thing" });
		expect(r.isError).toBe(false);
		expect(r.text).toBe('Task T1 "do thing" assigned to @x. Member is now active.');
	});

	it("assign 缺 name 返回原字面量", async () => {
		const m = createMockManager();
		const r = await run(m, { action: "assign", title: "t" });
		expect(r.isError).toBe(true);
		expect(r.text).toBe("Error: name (member) is required for assign");
	});

	it("assign 缺 title 返回原字面量", async () => {
		const m = createMockManager();
		const r = await run(m, { action: "assign", name: "x" });
		expect(r.isError).toBe(true);
		expect(r.text).toBe("Error: title is required for assign");
	});

	it("direct 返回单行格式", async () => {
		const m = createMockManager();
		const r = await run(m, { action: "direct", name: "x", kind: "context", payload: "p" });
		expect(r.isError).toBe(false);
		expect(r.text).toBe("Message sent to x [context].");
	});

	it("direct 缺 name/kind/payload 返回原字面量", async () => {
		const m = createMockManager();
		expect((await run(m, { action: "direct", kind: "context", payload: "p" })).text).toBe(
			"Error: name is required for direct",
		);
		expect((await run(m, { action: "direct", name: "x", payload: "p" })).text).toBe(
			"Error: kind is required for direct",
		);
		expect((await run(m, { action: "direct", name: "x", kind: "context" })).text).toBe(
			"Error: payload is required for direct",
		);
	});
});

describe("team tool — taskWarn 单条语义（D5：复现原异常冒泡 isError:true）", () => {
	it("单条 create 任务失败 → isError:true，错误消息来自 assignTask 异常", async () => {
		const m = createMockManager({
			assignImpl: () => {
				throw new Error("member not idle");
			},
		});
		const r = await run(m, {
			action: "create",
			name: "sasha",
			role: "dev",
			goal: "x",
			taskTitle: "Login",
		});
		expect(r.isError).toBe(true);
		// 原冒泡路径：err(e.message) → "Error: member not idle"
		expect(r.text).toBe("Error: member not idle");
		// 成员已被创建（副作用保留）
		expect(m.createCalls).toHaveLength(1);
	});

	it("单条 create 任务失败时 createMember 已成功执行", async () => {
		const m = createMockManager({
			assignImpl: () => {
				throw new Error("boom");
			},
		});
		await run(m, {
			action: "create",
			name: "sasha",
			role: "dev",
			goal: "x",
			taskTitle: "T",
		});
		expect(m.createCalls).toHaveLength(1);
		expect(m.assignCalls).toHaveLength(1);
	});
});

describe("team tool — 核心函数被单条与批量共享", () => {
	it("createOneMember：单条调 createMember 1 次，createBatch 调 N 次", async () => {
		const m1 = createMockManager();
		await run(m1, { action: "create", name: "a", role: "r", goal: "g" });
		expect(m1.createCalls).toHaveLength(1);

		const m2 = createMockManager();
		await run(m2, {
			action: "create-batch",
			members: [
				{ name: "a", role: "r", goal: "g" },
				{ name: "b", role: "r", goal: "g" },
				{ name: "c", role: "r", goal: "g" },
			],
		});
		expect(m2.createCalls).toHaveLength(3);
		expect(m2.createCalls.map((c) => c.name)).toEqual(["a", "b", "c"]);
	});

	it("assignOneTask：单条调 assignTask 1 次，assignBatch 调 N 次", async () => {
		const m1 = createMockManager();
		// 预设成员使 assign 不抛
		await run(m1, { action: "assign", name: "x", title: "t" });
		expect(m1.assignCalls).toHaveLength(1);

		const m2 = createMockManager();
		await run(m2, {
			action: "assign-batch",
			tasks: [
				{ name: "a", title: "t1" },
				{ name: "b", title: "t2" },
			],
		});
		expect(m2.assignCalls).toHaveLength(2);
	});

	it("directOneMessage：单条调 directMember 1 次，directBatch 调 N 次", async () => {
		const m1 = createMockManager();
		await run(m1, { action: "direct", name: "x", kind: "context", payload: "p" });
		expect(m1.directCalls).toHaveLength(1);

		const m2 = createMockManager();
		await run(m2, {
			action: "direct-batch",
			messages: [
				{ name: "a", kind: "context", payload: "p1" },
				{ name: "b", kind: "directive", payload: "p2" },
			],
		});
		expect(m2.directCalls).toHaveLength(2);
	});
});

describe("team tool — 批量 taskWarn 行为不变", () => {
	it("create-batch 成员成功 + 任务失败 → succeeded 桶带 taskWarn，不影响其他成员", async () => {
		const m = createMockManager({
			assignImpl: (t) => {
				if (t.memberName === "b") throw new Error("b not idle");
				return {
					id: `T-${t.memberName}`,
					title: t.title,
					description: t.description,
					memberName: t.memberName,
					priority: t.priority ?? "medium",
					done: false,
				};
			},
		});
		const r = await run(m, {
			action: "create-batch",
			members: [
				{ name: "a", role: "r", goal: "g", taskTitle: "ta" },
				{ name: "b", role: "r", goal: "g", taskTitle: "tb" },
				{ name: "c", role: "r", goal: "g" },
			],
		});
		expect(r.isError).toBe(false);
		// a 任务成功，b 任务失败带 taskWarn，c 无任务
		expect(r.text).toContain("✓ a (r) [T-a]");
		expect(r.text).toContain("✓ b (r) — task error: b not idle");
		expect(r.text).toContain("✓ c (r) — no task");
	});
});

describe("team tool — createMember 传参统一为直接赋值（D4）", () => {
	it("单条 create 不传 tools 时，createMember 收到 tools: undefined（非字段缺失）", async () => {
		const m = createMockManager();
		await run(m, { action: "create", name: "x", role: "r", goal: "g" });
		expect(m.createCalls).toHaveLength(1);
		// 直接赋值写法：字段存在，值为 undefined
		expect(m.createCalls[0]).toHaveProperty("tools", undefined);
		expect(m.createCalls[0]).toHaveProperty("skills", undefined);
		expect(m.createCalls[0]).toHaveProperty("mcps", undefined);
	});

	it("单条 create 传 tools 时透传", async () => {
		const m = createMockManager();
		await run(m, {
			action: "create",
			name: "x",
			role: "r",
			goal: "g",
			tools: ["read", "bash"],
			skills: ["s"],
			mcps: ["m"],
		});
		expect(m.createCalls[0].tools).toEqual(["read", "bash"]);
		expect(m.createCalls[0].skills).toEqual(["s"]);
		expect(m.createCalls[0].mcps).toEqual(["m"]);
	});

	it("create-batch 与单条传参写法一致（都直接赋值）", async () => {
		const mSingle = createMockManager();
		await run(mSingle, { action: "create", name: "x", role: "r", goal: "g" });
		const mBatch = createMockManager();
		await run(mBatch, { action: "create-batch", members: [{ name: "y", role: "r", goal: "g" }] });
		// 两边都应有 tools/skills/mcps 属性（值为 undefined）
		expect(mSingle.createCalls[0]).toHaveProperty("tools");
		expect(mBatch.createCalls[0]).toHaveProperty("tools");
	});
});
