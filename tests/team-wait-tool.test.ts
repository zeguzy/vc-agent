import { describe, expect, it } from "bun:test";
import type { TeamManagerLike } from "../src/teams/types-v2.js";
import type { Goal, GoalPriority, GoalStatus, TaskState } from "../src/teams/types-v2.js";
import { createTeamTool } from "../src/tools/team.js";

function createMockManager(): TeamManagerLike & {
	waitStarted: boolean;
	waitDuration: number;
	waitCancelled: boolean;
} {
	const stub = () => {
		throw new Error("not used in wait tests");
	};
	const state = { waitStarted: false, waitDuration: 0, waitCancelled: false };
	let waitTimer: ReturnType<typeof setTimeout> | null = null;

	return {
		...state,
		listMembers: () => [],
		getMaxWorkers: () => 4,
		createMember: stub,
		removeMember: stub,
		getMember: () => undefined,
		assignTask: stub,
		startDiscussion: stub,
		completeTask: stub,
		listTasks: () => [],
		createGoal: stub,
		listGoals: () => [],
		updateGoal: stub,
		decomposeGoal: stub,
		linkTaskToGoal: stub,
		requestTask: () => null,
		writeMemory: stub,
		readMemberIndex: () => null,
		readTopicFile: () => null,
		readTeamMd: () => ({
			mission: "",
			goals: [],
			members: [],
			activeTasks: [],
			importantNotes: "",
			sharedMemoryIndex: [],
		}),
		readInbox: () => [],
		pauseMember: stub,
		resumeMember: stub,
		cancelMember: stub,
		directMember: stub,
		sendMessage: stub,
		broadcastMessage: () => [],
		markInboxRead: () => 0,
		isSelfMember: () => false,
		getSelfMemberName: () => undefined,
		startWait(durationSec: number) {
			this.waitStarted = true;
			this.waitDuration = durationSec;
			this.waitCancelled = false;
		},
		cancelWait() {
			this.waitCancelled = true;
			this.waitStarted = false;
		},
		isWaiting() {
			return this.waitStarted && !this.waitCancelled;
		},
		getWaitRemaining() {
			if (!this.waitStarted || this.waitCancelled) return null;
			return this.waitDuration;
		},
		dispose: async () => {},
		subscribe: () => () => {},
	} as TeamManagerLike & typeof state;
}

async function runExecute(
	manager: TeamManagerLike,
	params: Record<string, unknown>,
): Promise<{ text: string; isError: boolean }> {
	const tool = createTeamTool({ teamRef: { current: manager } });
	const res = await tool.execute("test-id", params, undefined, undefined, undefined);
	const first = res.content[0] as { text: string };
	return { text: first.text, isError: res.isError === true };
}

describe("team tool — wait action (non-blocking)", () => {
	it("returns immediately without blocking", async () => {
		const manager = createMockManager();
		const start = Date.now();
		const res = await runExecute(manager, { action: "wait", duration: 60 });
		const elapsed = Date.now() - start;

		expect(elapsed).toBeLessThan(100);
		expect(res.isError).toBe(false);
		expect(res.text).toContain("background");
	});

	it("calls manager.startWait with clamped duration", async () => {
		const manager = createMockManager();
		await runExecute(manager, { action: "wait", duration: 1 });
		expect(manager.waitStarted).toBe(true);
		expect(manager.waitDuration).toBe(5);

		const manager2 = createMockManager();
		await runExecute(manager2, { action: "wait", duration: 999 });
		expect(manager2.waitDuration).toBe(300);
	});

	it("defaults to 30s when duration omitted", async () => {
		const manager = createMockManager();
		await runExecute(manager, { action: "wait" });
		expect(manager.waitDuration).toBe(30);
	});

	it("read shows waiting status when timer active", async () => {
		const manager = createMockManager();
		await runExecute(manager, { action: "wait", duration: 60 });

		const res = await runExecute(manager, { action: "read" });
		expect(res.text).toContain("Waiting");
		expect(res.text).toContain("60s remaining");
	});

	it("read does not show waiting status when no timer", async () => {
		const manager = createMockManager();
		const res = await runExecute(manager, { action: "read" });
		expect(res.text).not.toContain("Waiting");
	});
});
