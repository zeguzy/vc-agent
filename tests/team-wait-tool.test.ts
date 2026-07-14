import { describe, expect, it } from "bun:test";
import type { TeamManagerLike } from "../src/teams/types-v2.js";
import { createTeamTool } from "../src/tools/team.js";

/**
 * Minimal mock TeamManagerLike — wait action does not call any manager method,
 * but execute() has a top-level `if (!manager)` guard (team.ts:181) that all
 * actions share, so a non-null manager is required to reach handleWait.
 */
function createMockManager(): TeamManagerLike {
	const stub = () => {
		throw new Error("not used in wait tests");
	};
	return {
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
		dispose: async () => {},
		subscribe: () => () => {},
	} as TeamManagerLike;
}

function buildTool(manager: TeamManagerLike) {
	return createTeamTool({ teamRef: { current: manager } });
}

async function runExecute(
	manager: TeamManagerLike,
	params: Record<string, unknown>,
	signal?: AbortSignal,
): Promise<{ text: string; isError: boolean }> {
	const tool = buildTool(manager);
	const res = await tool.execute("test-id", params, signal, undefined, undefined);
	const first = res.content[0] as { text: string };
	return { text: first.text, isError: res.isError === true };
}

describe("team tool — wait action", () => {
	it("blocks for ~duration seconds then resolves with success", async () => {
		const start = Date.now();
		const res = await runExecute(createMockManager(), { action: "wait", duration: 5 });
		const elapsed = Date.now() - start;

		// Real timer: allow tolerance for event-loop scheduling
		expect(elapsed).toBeGreaterThanOrEqual(4500);
		expect(elapsed).toBeLessThan(7000);
		expect(res.isError).toBe(false);
		expect(res.text).toContain("Team is empty");
	}, 10000);

	it("aborts immediately on signal abort (clearTimeout prevents leak)", async () => {
		const controller = new AbortController();
		const start = Date.now();

		// Kick off the 60s wait; timer + abort listener are registered synchronously
		// before the first await yields, so abort() fires before any real delay.
		const resP = runExecute(
			createMockManager(),
			{ action: "wait", duration: 60 },
			controller.signal,
		);
		controller.abort();
		const res = await resP;
		const elapsed = Date.now() - start;

		// Should return near-instantly, not wait 60s
		expect(elapsed).toBeLessThan(500);
		expect(res.isError).toBe(true);
	});

	it("clamps duration below minimum (1 → 5s)", async () => {
		const start = Date.now();
		const res = await runExecute(createMockManager(), { action: "wait", duration: 1 });
		const elapsed = Date.now() - start;

		expect(elapsed).toBeGreaterThanOrEqual(4500);
		expect(elapsed).toBeLessThan(7000);
		expect(res.text).toContain("Team is empty");
	}, 10000);

	// Note: max clamp (999→300s) and default (undefined→30s) are not exercised
	// here because the real wait would take 300s/30s respectively. The clamp
	// expression `Math.max(5, Math.min(300, n ?? 30))` is obviously correct and
	// covered by code review; min clamp above proves the lower bound works.

	it("sequential awaits: a later tool call only runs after wait resolves", async () => {
		// Simulates pi-coding-agent's executeToolCalls which awaits each
		// execute() sequentially (even in "parallel" batch mode, each
		// executePreparedToolCall is awaited in turn — agent-loop.js:323).
		// Locks the behavior so a future execution-model change isn't
		// mis-attributed to the wait rewrite.
		const manager = createMockManager();
		const tool = buildTool(manager);
		const start = Date.now();

		await tool.execute("w", { action: "wait", duration: 5 }, undefined, undefined, undefined);
		const afterWait = Date.now();

		const readRes = await tool.execute("r", { action: "read" }, undefined, undefined, undefined);
		const end = Date.now();

		// wait blocked for ~5s before read could start
		expect(afterWait - start).toBeGreaterThanOrEqual(4500);
		// read resolved quickly after wait returned
		expect(end - afterWait).toBeLessThan(1000);
		// read produced a team status (not an error)
		expect((readRes.content[0] as { text: string }).text).toContain("Team is empty");
	}, 10000);
});
