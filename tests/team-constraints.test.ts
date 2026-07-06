import { describe, expect, it } from "bun:test";
import type { MemberState, TeamManagerLike } from "../src/teams/types-v2.js";
import { createTeamTool } from "../src/tools/team.js";

type MemberInput = {
	name: string;
	role: string;
	goal: string;
	constraints?: string;
	model?: string;
	services: unknown;
	parentModel?: unknown;
};

type MockManager = TeamManagerLike & { createCalls: MemberInput[] };

function createMockManager(): MockManager {
	const createCalls: MemberInput[] = [];
	const createMember = async (input: MemberInput): Promise<MemberState> => {
		createCalls.push(input);
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
	const stub = () => {
		throw new Error("not used in this test");
	};
	return {
		createMember,
		assignTask: stub,
		removeMember: stub,
		getMember: () => undefined,
		listMembers: () => [],
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
		getMaxWorkers: () => 4,
		isSelfMember: () => false,
		getSelfMemberName: () => undefined,
		dispose: async () => {},
		subscribe: () => () => {},
		createCalls,
	} as unknown as MockManager;
}

async function runTool(manager: MockManager, params: Record<string, unknown>): Promise<void> {
	const tool = createTeamTool({ teamRef: { current: manager } });
	await tool.execute("test-id", params, undefined as never, undefined as never, undefined as never);
}

describe("team tool constraints passthrough", () => {
	it("create action passes constraints to createMember", async () => {
		const manager = createMockManager();
		await runTool(manager, {
			action: "create",
			name: "kim",
			role: "reviewer",
			goal: "审查",
			constraints: "must run tests, no rubber-stamping",
		});

		expect(manager.createCalls.length).toBe(1);
		expect(manager.createCalls[0].constraints).toBe("must run tests, no rubber-stamping");
	});

	it("create without constraints is backward compatible (passes undefined)", async () => {
		const manager = createMockManager();
		await runTool(manager, {
			action: "create",
			name: "sam",
			role: "dev",
			goal: "x",
		});

		expect(manager.createCalls.length).toBe(1);
		expect(manager.createCalls[0].constraints).toBeUndefined();
	});

	it("create-batch passes per-member constraints independently", async () => {
		const manager = createMockManager();
		await runTool(manager, {
			action: "create-batch",
			members: [
				{ name: "alice", role: "frontend", goal: "UI", constraints: "must pass lint" },
				{ name: "bob", role: "backend", goal: "API" },
				{ name: "cara", role: "reviewer", goal: "审查", constraints: "must run tests" },
			],
		});

		expect(manager.createCalls.length).toBe(3);
		expect(manager.createCalls[0].constraints).toBe("must pass lint");
		expect(manager.createCalls[1].constraints).toBeUndefined();
		expect(manager.createCalls[2].constraints).toBe("must run tests");
	});
});
