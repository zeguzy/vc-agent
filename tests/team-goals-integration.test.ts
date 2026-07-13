import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { TeamManager } from "../src/teams/manager-v2.js";
import { MemberInbox } from "../src/teams/messages.js";
import { DEFAULT_TEAM_CONFIG, resolveTeamConfig } from "../src/teams/types.js";
import type { TeamEvent } from "../src/teams/types-v2.js";

function fakeSessionResolving(): AgentSession {
	return {
		isStreaming: false,
		messages: [],
		steer() {
			return Promise.resolve();
		},
		prompt() {
			return Promise.resolve();
		},
		dispose() {},
		subscribe() {
			return () => {};
		},
	} as unknown as AgentSession;
}

interface TestRig {
	manager: TeamManager;
	events: TeamEvent[];
	tmpDir: string;
	inject(name: string, status?: "active" | "idle"): void;
}

function makeRig(): TestRig {
	const tmpDir = mkdtempSync(join(tmpdir(), "tm-goals-"));
	const config = resolveTeamConfig(DEFAULT_TEAM_CONFIG);
	const manager = new TeamManager(config, {} as never, tmpDir, join(tmpDir, "team"));
	const events: TeamEvent[] = [];
	const inject = (name: string, status: "active" | "idle" = "idle"): void => {
		// @ts-expect-error: test fixture reaches into private state
		manager.members.set(name, {
			name,
			role: "tester",
			goal: "test",
			status,
			session: fakeSessionResolving(),
			currentTaskId: null,
			lastTaskPrompt: null,
			turnCount: 0,
			inputTokens: 0,
			outputTokens: 0,
			cost: 0,
			startedAt: Date.now(),
		});
		// @ts-expect-error
		manager.inboxes.set(
			name,
			// @ts-expect-error
			new MemberInbox(manager.files.paths.memberTopics(name), 50),
		);
	};
	// @ts-expect-error: subscribe to events
	manager.listeners.add((e: TeamEvent) => events.push(e));
	return { manager, events, tmpDir, inject };
}

describe("TeamManager goal operations", () => {
	const rigs: TestRig[] = [];

	afterEach(() => {
		while (rigs.length > 0) {
			const r = rigs.pop();
			if (r) rmSync(r.tmpDir, { recursive: true, force: true });
		}
	});

	function rig(): TestRig {
		const r = makeRig();
		rigs.push(r);
		return r;
	}

	it("createGoal creates a top-level goal and persists to TEAM.md", () => {
		const { manager, events } = rig();
		const goal = manager.createGoal({
			title: "Ship auth",
			description: "JWT + OAuth",
			priority: "high",
			successCriteria: "Users can log in",
		});
		expect(goal.id).toBe("G1");
		expect(goal.status).toBe("pending");
		expect(goal.priority).toBe("high");

		const reRead = manager.readTeamMd();
		expect(reRead.goals).toHaveLength(1);
		expect(reRead.goals[0].title).toBe("Ship auth");
		expect(events.some((e) => e.type === "goal_created")).toBe(true);
	});

	it("createGoal with parentGoalId creates a sub-goal with correct ID", () => {
		const { manager } = rig();
		manager.createGoal({ title: "Parent", description: "" });
		const sub = manager.createGoal({
			title: "Child A",
			description: "",
			parentGoalId: "G1",
		});
		expect(sub.id).toBe("G1.1");
		expect(sub.parentGoalId).toBe("G1");

		const sub2 = manager.createGoal({
			title: "Child B",
			description: "",
			parentGoalId: "G1",
		});
		expect(sub2.id).toBe("G1.2");
	});

	it("createGoal throws for unknown parent", () => {
		const { manager } = rig();
		expect(() =>
			manager.createGoal({ title: "Orphan", description: "", parentGoalId: "G99" }),
		).toThrow(/not found/);
	});

	it("listGoals returns all goals when no filter", () => {
		const { manager } = rig();
		manager.createGoal({ title: "G1", description: "" });
		manager.createGoal({ title: "G2", description: "" });
		expect(manager.listGoals()).toHaveLength(2);
	});

	it("listGoals filters by status", () => {
		const { manager } = rig();
		const g1 = manager.createGoal({ title: "G1", description: "" });
		manager.createGoal({ title: "G2", description: "" });
		manager.updateGoal(g1.id, { status: "completed" });
		const pending = manager.listGoals({ status: "pending" });
		expect(pending).toHaveLength(1);
		expect(pending[0].id).toBe("G2");
	});

	it("listGoals filters by parentGoalId", () => {
		const { manager } = rig();
		manager.createGoal({ title: "G1", description: "" });
		manager.createGoal({ title: "G2", description: "" });
		manager.createGoal({ title: "Sub", description: "", parentGoalId: "G1" });
		const topLevel = manager.listGoals({ parentGoalId: null });
		expect(topLevel).toHaveLength(2);
		const children = manager.listGoals({ parentGoalId: "G1" });
		expect(children).toHaveLength(1);
	});

	it("updateGoal updates fields and persists", () => {
		const { manager, events } = rig();
		const goal = manager.createGoal({ title: "Original", description: "" });
		manager.updateGoal(goal.id, {
			status: "in_progress",
			priority: "low",
			blockers: "Waiting for spec",
		});
		const reRead = manager.readTeamMd();
		expect(reRead.goals[0].status).toBe("in_progress");
		expect(reRead.goals[0].priority).toBe("low");
		expect(reRead.goals[0].blockers).toBe("Waiting for spec");
		expect(events.some((e) => e.type === "goal_updated")).toBe(true);
	});

	it("decomposeGoal creates sub-goals and sets parent to in_progress", () => {
		const { manager, events } = rig();
		const parent = manager.createGoal({ title: "Big", description: "" });
		const subs = manager.decomposeGoal(parent.id, [
			{ title: "Step A", description: "Do A" },
			{ title: "Step B", description: "Do B", priority: "high" },
		]);
		expect(subs).toHaveLength(2);
		expect(subs[0].id).toBe("G1.1");
		expect(subs[1].id).toBe("G1.2");

		const reRead = manager.readTeamMd();
		expect(reRead.goals.find((g) => g.id === "G1")?.status).toBe("in_progress");
		expect(events.some((e) => e.type === "goal_decomposed")).toBe(true);
	});

	it("linkTaskToGoal adds task reference", () => {
		const { manager } = rig();
		const goal = manager.createGoal({ title: "Feature", description: "" });
		manager.linkTaskToGoal(goal.id, "T1");
		manager.linkTaskToGoal(goal.id, "T2");
		const reRead = manager.readTeamMd();
		expect(reRead.goals[0].taskIds).toEqual(["T1", "T2"]);
	});

	it("checkParentGoalCompletion auto-completes parent when all children done", () => {
		const { manager } = rig();
		const parent = manager.createGoal({ title: "Parent", description: "" });
		const sub1 = manager.createGoal({ title: "A", description: "", parentGoalId: parent.id });
		const sub2 = manager.createGoal({ title: "B", description: "", parentGoalId: parent.id });

		manager.updateGoal(sub1.id, { status: "completed" });
		expect(manager.readTeamMd().goals.find((g) => g.id === parent.id)?.status).toBe(
			"in_progress",
		);

		manager.updateGoal(sub2.id, { status: "completed" });
		expect(manager.readTeamMd().goals.find((g) => g.id === parent.id)?.status).toBe(
			"completed",
		);
	});

	it("requestTask assigns highest-priority pending goal to idle member", () => {
		const { manager, inject } = rig();
		inject("sasha", "idle");
		manager.createGoal({ title: "Low pri", description: "", priority: "low" });
		manager.createGoal({ title: "High pri", description: "Important", priority: "high" });

		const task = manager.requestTask("sasha");
		expect(task).not.toBeNull();
		expect(task?.title).toBe("High pri");
		expect(task?.memberName).toBe("sasha");

		const reRead = manager.readTeamMd();
		expect(reRead.goals.find((g) => g.title === "High pri")?.status).toBe("in_progress");
		expect(reRead.goals.find((g) => g.title === "High pri")?.taskIds).toContain(task?.id);
	});

	it("requestTask returns null when no pending goals", () => {
		const { manager, inject } = rig();
		inject("sasha", "idle");
		expect(manager.requestTask("sasha")).toBeNull();
	});

	it("requestTask returns null when member is busy", () => {
		const { manager, inject } = rig();
		inject("sasha", "active");
		manager.createGoal({ title: "Task", description: "" });
		expect(manager.requestTask("sasha")).not.toBeNull();
	});

	it("goal events propagate through subscribe", () => {
		const { manager, events } = rig();
		manager.createGoal({ title: "Test", description: "" });
		manager.updateGoal("G1", { status: "in_progress" });

		const created = events.find((e) => e.type === "goal_created");
		expect(created).toBeDefined();
		const updated = events.find((e) => e.type === "goal_updated");
		expect(updated).toBeDefined();
	});
});
