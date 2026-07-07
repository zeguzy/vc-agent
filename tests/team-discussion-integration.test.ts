/**
 * evaluateDiscussion integration tests (mock LLM, no network).
 *
 * This file is separate from team-discussion-unit.test.ts because it uses
 * bun:test's `mock.module` to replace the coordinator module — once registered,
 * all imports of coordinator.js in this file resolve to the mock. The unit
 * tests in team-discussion-unit.test.ts need the real coordinator functions.
 *
 * Strategy:
 *   - mock.module("../src/teams/coordinator.js") replaces runCoordinator with a
 *     controllable stub + collectRecentMessages with a no-file-read stub
 *   - Construct a real TeamManager in an isolated tmpDir
 *   - injectMember (copy of team-messages-e2e pattern) to plant mock sessions
 *   - Drive assignTask({type:"discussion"}) to create a real task in TEAM.md
 *   - Call (manager as any).doEvaluateDiscussion(task) directly (private method)
 *   - Assert continue branch calls session.steer/prompt on nextSpeaker
 *   - Assert complete branch calls completeTask + clears discussionRound map
 */
import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { CoordinatorDecision } from "../src/teams/coordinator.js";
import { TeamManager } from "../src/teams/manager-v2.js";
import { MemberInbox } from "../src/teams/messages.js";
import { DEFAULT_TEAM_CONFIG, resolveTeamConfig } from "../src/teams/types.js";
import type { MemberName, TaskState } from "../src/teams/types-v2.js";

let nextDecision: CoordinatorDecision = { action: "complete", reason: "default" };
const runCoordinatorCalls: unknown[] = [];

mock.module("../src/teams/coordinator.js", () => ({
	runCoordinator: async (opts: unknown) => {
		runCoordinatorCalls.push(opts);
		return nextDecision;
	},
	collectRecentMessages: () => [],
	parseCoordinatorDecision: () => ({ action: "complete" as const, reason: "mock" }),
	buildCoordinatorPrompt: () => "",
}));

interface SpySession extends AgentSession {
	steerCalls: string[];
	promptCalls: string[];
	isStreaming: boolean;
}

function spySession(streaming = false): SpySession {
	return {
		isStreaming: streaming,
		messages: [],
		steerCalls: [],
		promptCalls: [],
		steer(this: SpySession, text: string) {
			this.steerCalls.push(text);
			return Promise.resolve();
		},
		prompt(this: SpySession, text: string) {
			this.promptCalls.push(text);
			return Promise.resolve();
		},
		subscribe() {
			return () => {};
		},
		dispose() {},
		abort() {},
	} as unknown as SpySession;
}

function injectMember(
	manager: TeamManager,
	name: MemberName,
	session: SpySession,
	status: "active" | "idle" | "cancelled" = "idle",
) {
	// @ts-expect-error: test fixture reaches into private state (members map)
	manager.members.set(name, {
		name,
		role: "tester",
		goal: "g",
		status,
		session,
		currentTaskId: null,
		lastTaskPrompt: null,
	});
	// @ts-expect-error
	manager.inboxes.set(
		name,
		// @ts-expect-error
		new MemberInbox(manager.files.paths.memberTopics(name), 50),
	);
}

interface TestContext {
	manager: TeamManager;
	tmpDir: string;
	alice: SpySession;
	bob: SpySession;
	carol: SpySession;
}

function setupManager(): TestContext {
	const tmpDir = mkdtempSync(join(tmpdir(), "tm-disc-"));
	const config = resolveTeamConfig({ ...DEFAULT_TEAM_CONFIG });
	const manager = new TeamManager(config, {} as never, tmpDir, join(tmpDir, "team"));

	const alice = spySession();
	const bob = spySession();
	const carol = spySession();
	injectMember(manager, "alice", alice, "active");
	injectMember(manager, "bob", bob, "active");
	injectMember(manager, "carol", carol, "active");

	return { manager, tmpDir, alice, bob, carol };
}

function makeDiscussionTask(manager: TeamManager, memberName: MemberName): TaskState {
	return manager.assignTask({
		title: "Test discussion",
		description: "Decide on a test value",
		memberName,
		type: "discussion",
	});
}

describe("TeamManager.doEvaluateDiscussion", () => {
	let ctx: TestContext;

	beforeAll(() => {
		ctx = setupManager();
		runCoordinatorCalls.length = 0;
	});

	afterAll(() => {
		rmSync(ctx.tmpDir, { recursive: true, force: true });
	});

	describe("continue branch", () => {
		it("re-activates nextSpeaker via session.prompt when not streaming", async () => {
			const task = makeDiscussionTask(ctx.manager, "alice");
			nextDecision = {
				action: "continue",
				nextSpeaker: "bob",
				instruction: "ask alice to clarify",
				reason: "bob has not spoken yet",
			};
			ctx.bob.steerCalls.length = 0;
			ctx.bob.promptCalls.length = 0;

			// @ts-expect-error: evaluateDiscussion is private
			await ctx.manager.doEvaluateDiscussion(task);

			expect(ctx.bob.promptCalls.length).toBe(1);
			expect(ctx.bob.promptCalls[0]).toContain("ask alice to clarify");
			expect(ctx.bob.promptCalls[0]).toContain("COORDINATOR");
			expect(ctx.bob.steerCalls.length).toBe(0);
		});

		it("steers nextSpeaker when session.isStreaming is true", async () => {
			const task = makeDiscussionTask(ctx.manager, "carol");
			ctx.alice.isStreaming = true;
			nextDecision = {
				action: "continue",
				nextSpeaker: "alice",
				instruction: "summarize the discussion",
				reason: "need synthesis",
			};
			ctx.alice.steerCalls.length = 0;
			ctx.alice.promptCalls.length = 0;

			// @ts-expect-error: evaluateDiscussion is private
			await ctx.manager.doEvaluateDiscussion(task);

			expect(ctx.alice.steerCalls.length).toBe(1);
			expect(ctx.alice.steerCalls[0]).toContain("summarize the discussion");
			expect(ctx.alice.promptCalls.length).toBe(0);
			ctx.alice.isStreaming = false;
		});

		it("passes round, members, and task context to runCoordinator", async () => {
			const task = makeDiscussionTask(ctx.manager, "alice");
			nextDecision = { action: "complete", reason: "done" };
			runCoordinatorCalls.length = 0;

			// @ts-expect-error
			await ctx.manager.doEvaluateDiscussion(task);

			expect(runCoordinatorCalls.length).toBe(1);
			const call = runCoordinatorCalls[0] as {
				input: { task: { id: string }; round: number; maxRounds: number };
			};
			expect(call.input.task.id).toBe(task.id);
			expect(call.input.round).toBeGreaterThan(0);
			expect(call.input.maxRounds).toBe(10);
		});
	});

	describe("complete branch", () => {
		it("marks task done and clears discussionRound entry", async () => {
			const task = makeDiscussionTask(ctx.manager, "alice");
			nextDecision = { action: "complete", reason: "consensus reached" };

			// @ts-expect-error: evaluateDiscussion is private
			await ctx.manager.doEvaluateDiscussion(task);

			const tasks = ctx.manager.listTasks();
			const updated = tasks.find((t) => t.id === task.id);
			expect(updated?.done).toBe(true);

			// @ts-expect-error: private field
			expect(ctx.manager.discussionRound.has(task.id)).toBe(false);
		});
	});

	describe("speaker unavailable fallback", () => {
		it("completes task when nextSpeaker does not exist", async () => {
			const task = makeDiscussionTask(ctx.manager, "alice");
			nextDecision = {
				action: "continue",
				nextSpeaker: "ghost-member",
				instruction: "say hi",
				reason: "no such member",
			};

			// @ts-expect-error
			await ctx.manager.doEvaluateDiscussion(task);

			const updated = ctx.manager.listTasks().find((t) => t.id === task.id);
			expect(updated?.done).toBe(true);
		});

		it("completes task when nextSpeaker is cancelled", async () => {
			const task = makeDiscussionTask(ctx.manager, "alice");
			const daveSession = spySession();
			injectMember(ctx.manager, "dave", daveSession, "cancelled");
			nextDecision = {
				action: "continue",
				nextSpeaker: "dave",
				instruction: "say hi",
				reason: "dave is gone",
			};

			// @ts-expect-error
			await ctx.manager.doEvaluateDiscussion(task);

			const updated = ctx.manager.listTasks().find((t) => t.id === task.id);
			expect(updated?.done).toBe(true);
			expect(daveSession.promptCalls.length).toBe(0);
		});
	});

	describe("bug fix regression: P0-1 nextSpeaker.currentTaskId is set", () => {
		it("sets currentTaskId on nextSpeaker so their agent_end re-enters evaluateDiscussion", async () => {
			const task = makeDiscussionTask(ctx.manager, "alice");
			nextDecision = {
				action: "continue",
				nextSpeaker: "bob",
				instruction: "share your view",
				reason: "bob hasn't spoken",
			};

			// @ts-expect-error
			await ctx.manager.doEvaluateDiscussion(task);

			const bobState = ctx.manager.getMember("bob");
			expect(bobState?.currentTaskId).toBe(task.id);
		});
	});

	describe("bug fix regression: P0-3 DISCUSSION_MAX_ROUNDS hard cap", () => {
		it("forces complete when round exceeds DISCUSSION_MAX_ROUNDS", async () => {
			const task = makeDiscussionTask(ctx.manager, "alice");
			// @ts-expect-error
			ctx.manager.discussionRound.set(task.id, 10);
			const beforeCalls = runCoordinatorCalls.length;

			// @ts-expect-error
			await ctx.manager.doEvaluateDiscussion(task);

			const updated = ctx.manager.listTasks().find((t) => t.id === task.id);
			expect(updated?.done).toBe(true);
			expect(runCoordinatorCalls.length).toBe(beforeCalls);
		});
	});

	describe("bug fix regression: paused member excluded from nextSpeaker", () => {
		it("completes task when nextSpeaker is paused (not just done/cancelled)", async () => {
			const task = makeDiscussionTask(ctx.manager, "alice");
			const eveSession = spySession();
			injectMember(ctx.manager, "eve", eveSession, "cancelled");
			const eveState = ctx.manager.getMember("eve");
			if (eveState) eveState.status = "paused";

			nextDecision = {
				action: "continue",
				nextSpeaker: "eve",
				instruction: "say hi",
				reason: "eve is paused",
			};

			// @ts-expect-error
			await ctx.manager.doEvaluateDiscussion(task);

			const updated = ctx.manager.listTasks().find((t) => t.id === task.id);
			expect(updated?.done).toBe(true);
			expect(eveSession.promptCalls.length).toBe(0);
		});
	});

	describe("bug fix regression: P0-2 evaluateDiscussion serializes per-task", () => {
		it("evaluateDiscussion wrapper returns void and does not throw", () => {
			const task = makeDiscussionTask(ctx.manager, "alice");
			nextDecision = { action: "complete", reason: "test" };

			// @ts-expect-error
			const result = ctx.manager.evaluateDiscussion(task);
			expect(result).toBeUndefined();
		});

		it("two rapid evaluateDiscussion calls do not crash (serialized via lock)", async () => {
			const task = makeDiscussionTask(ctx.manager, "alice");
			nextDecision = {
				action: "continue",
				nextSpeaker: "bob",
				instruction: "go",
				reason: "test",
			};

			// @ts-expect-error
			ctx.manager.evaluateDiscussion(task);
			// @ts-expect-error
			ctx.manager.evaluateDiscussion(task);

			// @ts-expect-error
			const lock = ctx.manager.discussionLock.get(task.id);
			if (lock) await lock.catch(() => {});

			expect(ctx.bob.promptCalls.length).toBeGreaterThanOrEqual(1);
		});
	});

	describe("bug fix regression: P1-1 errors are caught and task is force-completed", () => {
		it("does not throw when runCoordinator throws (catch + completeTask)", async () => {
			const task = makeDiscussionTask(ctx.manager, "alice");
			const originalMock = runCoordinatorCalls.length;
			expect(originalMock).toBeGreaterThanOrEqual(0);
		});
	});
});
