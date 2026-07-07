import { describe, expect, it } from "bun:test";
import type { TaskState, TeamManagerLike } from "../src/teams/types-v2.js";
import {
	ASSIGN_BATCH_SOFT_LIMIT,
	createTeamTool,
	DIRECT_BATCH_SOFT_LIMIT,
} from "../src/tools/team.js";

type AssignInput = {
	title: string;
	description: string;
	memberName: string;
	priority?: "high" | "medium" | "low";
};

type DirectInput = {
	name: string;
	kind: "directive" | "context" | "redirect";
	payload: string;
};

type MockManager = TeamManagerLike & {
	assignCalls: AssignInput[];
	directCalls: DirectInput[];
};

function createMockManager(opts: {
	assignImpl?: (t: AssignInput) => TaskState;
	directImpl?: (d: DirectInput) => void;
}): MockManager {
	const assignCalls: AssignInput[] = [];
	const directCalls: DirectInput[] = [];

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

	const directMember = (
		name: string,
		kind: "directive" | "context" | "redirect",
		payload: string,
	): void => {
		directCalls.push({ name, kind, payload });
		if (opts.directImpl) opts.directImpl({ name, kind, payload });
	};

	const stub = () => {
		throw new Error("not used in this test");
	};

	return {
		assignTask,
		directMember,
		listMembers: () => [],
		getMaxWorkers: () => 4,
		createMember: stub,
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

describe("team tool — assign-batch", () => {
	it("assigns all tasks and reports each with taskId", async () => {
		const m = createMockManager({});
		const { text, isError } = await run(m, {
			action: "assign-batch",
			tasks: [
				{ name: "sasha", title: "Login validation", description: "validate email" },
				{ name: "marcus", title: "API schema", priority: "high" },
			],
		});

		expect(isError).toBe(false);
		expect(text).toContain("Assigned 2 task(s):");
		expect(text).toContain('✓ T1 "Login validation" → @sasha');
		expect(text).toContain('✓ T2 "API schema" → @marcus');
		expect(m.assignCalls).toHaveLength(2);
		expect(m.assignCalls[0].memberName).toBe("sasha");
		expect(m.assignCalls[0].priority).toBe("medium");
		expect(m.assignCalls[1].priority).toBe("high");
	});

	it("isolates per-task failures and reports succeeded + failed separately", async () => {
		let okSeq = 0;
		const m = createMockManager({
			assignImpl: (input) => {
				if (input.memberName === "kim") throw new Error(`member "kim" not found`);
				okSeq += 1;
				return {
					id: `T${okSeq}`,
					title: input.title,
					description: input.description,
					memberName: input.memberName,
					priority: input.priority ?? "medium",
					done: false,
				};
			},
		});

		const { text, isError } = await run(m, {
			action: "assign-batch",
			tasks: [
				{ name: "sasha", title: "Login" },
				{ name: "kim", title: "Broken" },
				{ name: "marcus", title: "API" },
			],
		});

		expect(isError).toBe(false);
		expect(text).toContain("Assigned 2 task(s):");
		expect(text).toContain('✓ T1 "Login" → @sasha');
		expect(text).toContain('✓ T2 "API" → @marcus');
		expect(text).toContain("Failed 1 task(s):");
		expect(text).toContain('✗ @kim: member "kim" not found');
		expect(m.assignCalls).toHaveLength(3);
	});

	it("returns err when tasks array is missing", async () => {
		const m = createMockManager({});
		const { text, isError } = await run(m, { action: "assign-batch" });

		expect(isError).toBe(true);
		expect(text).toContain("tasks array is required and must not be empty");
		expect(m.assignCalls).toHaveLength(0);
	});

	it("returns err when tasks array is empty", async () => {
		const m = createMockManager({});
		const { text, isError } = await run(m, { action: "assign-batch", tasks: [] });

		expect(isError).toBe(true);
		expect(text).toContain("tasks array is required and must not be empty");
		expect(m.assignCalls).toHaveLength(0);
	});

	it("returns err when batch size exceeds soft limit", async () => {
		const m = createMockManager({});
		const oversized = Array.from({ length: ASSIGN_BATCH_SOFT_LIMIT + 1 }, (_, i) => ({
			name: `m${i}`,
			title: `Task ${i}`,
		}));
		const { text, isError } = await run(m, { action: "assign-batch", tasks: oversized });

		expect(isError).toBe(true);
		expect(text).toContain("exceeds soft limit");
		expect(text).toContain(String(ASSIGN_BATCH_SOFT_LIMIT));
		expect(m.assignCalls).toHaveLength(0);
	});

	it("marks isError=true only when all tasks fail", async () => {
		const m = createMockManager({
			assignImpl: () => {
				throw new Error("boom");
			},
		});
		const { text, isError } = await run(m, {
			action: "assign-batch",
			tasks: [
				{ name: "a", title: "t1" },
				{ name: "b", title: "t2" },
			],
		});

		expect(isError).toBe(true);
		expect(text).toContain("Assigned 0 task(s):");
		expect(text).toContain("Failed 2 task(s):");
		expect(text).toContain("✗ @a: boom");
		expect(text).toContain("✗ @b: boom");
	});
});

describe("team tool — direct-batch", () => {
	it("sends all messages and reports each with kind", async () => {
		const m = createMockManager({});
		const { text, isError } = await run(m, {
			action: "direct-batch",
			messages: [
				{ name: "sasha", kind: "context", payload: "design at /docs/m.fig" },
				{ name: "marcus", kind: "directive", payload: "use JWT auth" },
			],
		});

		expect(isError).toBe(false);
		expect(text).toContain("Sent 2 message(s):");
		expect(text).toContain("✓ @sasha [context]: design at /docs/m.fig");
		expect(text).toContain("✓ @marcus [directive]: use JWT auth");
		expect(m.directCalls).toHaveLength(2);
		expect(m.directCalls[0].name).toBe("sasha");
		expect(m.directCalls[1].kind).toBe("directive");
	});

	it("isolates per-message failures", async () => {
		const m = createMockManager({
			directImpl: (d) => {
				if (d.name === "kim") throw new Error(`member "kim" not found`);
			},
		});

		const { text, isError } = await run(m, {
			action: "direct-batch",
			messages: [
				{ name: "sasha", kind: "context", payload: "hi" },
				{ name: "kim", kind: "directive", payload: "do x" },
				{ name: "marcus", kind: "redirect", payload: "switch" },
			],
		});

		expect(isError).toBe(false);
		expect(text).toContain("Sent 2 message(s):");
		expect(text).toContain("✓ @sasha [context]: hi");
		expect(text).toContain("✓ @marcus [redirect]: switch");
		expect(text).toContain("Failed 1 message(s):");
		expect(text).toContain('✗ @kim: member "kim" not found');
		expect(m.directCalls).toHaveLength(3);
	});

	it("applies multiple redirects to the same member in array order (last wins)", async () => {
		const m = createMockManager({});
		const { text, isError } = await run(m, {
			action: "direct-batch",
			messages: [
				{ name: "sasha", kind: "redirect", payload: "do A" },
				{ name: "sasha", kind: "redirect", payload: "do B" },
				{ name: "sasha", kind: "redirect", payload: "do C" },
			],
		});

		expect(isError).toBe(false);
		expect(text).toContain("Sent 3 message(s):");
		expect(m.directCalls).toHaveLength(3);
		expect(m.directCalls[0].payload).toBe("do A");
		expect(m.directCalls[1].payload).toBe("do B");
		expect(m.directCalls[2].payload).toBe("do C");
		for (const c of m.directCalls) {
			expect(c.name).toBe("sasha");
			expect(c.kind).toBe("redirect");
		}
	});

	it("returns err when messages array is missing", async () => {
		const m = createMockManager({});
		const { text, isError } = await run(m, { action: "direct-batch" });

		expect(isError).toBe(true);
		expect(text).toContain("messages array is required and must not be empty");
		expect(m.directCalls).toHaveLength(0);
	});

	it("returns err when messages array is empty", async () => {
		const m = createMockManager({});
		const { text, isError } = await run(m, { action: "direct-batch", messages: [] });

		expect(isError).toBe(true);
		expect(text).toContain("messages array is required and must not be empty");
		expect(m.directCalls).toHaveLength(0);
	});

	it("returns err when batch size exceeds soft limit", async () => {
		const m = createMockManager({});
		const oversized = Array.from({ length: DIRECT_BATCH_SOFT_LIMIT + 1 }, (_, i) => ({
			name: `m${i % 4}`,
			kind: "context" as const,
			payload: `msg ${i}`,
		}));
		const { text, isError } = await run(m, { action: "direct-batch", messages: oversized });

		expect(isError).toBe(true);
		expect(text).toContain("exceeds soft limit");
		expect(text).toContain(String(DIRECT_BATCH_SOFT_LIMIT));
		expect(m.directCalls).toHaveLength(0);
	});

	it("truncates long payloads to 60 chars with ellipsis in the report", async () => {
		const m = createMockManager({});
		const longPayload = "A".repeat(70);
		const { text, isError } = await run(m, {
			action: "direct-batch",
			messages: [{ name: "sasha", kind: "context", payload: longPayload }],
		});

		expect(isError).toBe(false);
		expect(text).toContain(`${"A".repeat(60)}…`);
		expect(text).not.toContain("A".repeat(70));
		expect(m.directCalls).toHaveLength(1);
		expect(m.directCalls[0].payload).toBe(longPayload);
	});

	it("marks isError=true only when all messages fail", async () => {
		const m = createMockManager({
			directImpl: () => {
				throw new Error("down");
			},
		});
		const { text, isError } = await run(m, {
			action: "direct-batch",
			messages: [
				{ name: "a", kind: "context", payload: "x" },
				{ name: "b", kind: "directive", payload: "y" },
			],
		});

		expect(isError).toBe(true);
		expect(text).toContain("Sent 0 message(s):");
		expect(text).toContain("Failed 2 message(s):");
		expect(text).toContain("✗ @a: down");
		expect(text).toContain("✗ @b: down");
	});
});

describe("team tool — assign / direct (single, backward compat)", () => {
	it("still assigns a single task via action=assign without touching tasks field", async () => {
		const m = createMockManager({});
		const { text, isError } = await run(m, {
			action: "assign",
			name: "solo",
			title: "Do thing",
			description: "desc",
		});

		expect(isError).toBe(false);
		expect(text).toContain('Task T1 "Do thing" assigned to @solo');
		expect(m.assignCalls).toHaveLength(1);
		expect(m.assignCalls[0].memberName).toBe("solo");
	});

	it("still sends a single message via action=direct without touching messages field", async () => {
		const m = createMockManager({});
		const { text, isError } = await run(m, {
			action: "direct",
			name: "solo",
			kind: "context",
			payload: "hello",
		});

		expect(isError).toBe(false);
		expect(text).toContain("Message sent to solo [context]");
		expect(m.directCalls).toHaveLength(1);
		expect(m.directCalls[0].payload).toBe("hello");
	});
});
