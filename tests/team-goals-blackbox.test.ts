import { describe, expect, it } from "bun:test";
import type {
	Goal,
	GoalPriority,
	GoalStatus,
	TaskState,
	TeamManagerLike,
} from "../src/teams/types-v2.js";
import { createTeamTool } from "../src/tools/team.js";

function createGoalMockManager() {
	const goals: Goal[] = [];
	let goalCounter = 0;
	let taskCounter = 0;

	const manager: TeamManagerLike = {
		createMember: () => Promise.resolve({} as never),
		removeMember: () => Promise.resolve(),
		getMember: () => undefined,
		listMembers: () => [],

		assignTask: (opts): TaskState => {
			const task: TaskState = {
				id: `T${++taskCounter}`,
				title: opts.title,
				description: opts.description,
				memberName: opts.memberName,
				priority: opts.priority ?? "medium",
				type: opts.type ?? "execution",
				done: false,
			};
			return task;
		},
		startDiscussion: (opts): TaskState => ({
			id: `T${++taskCounter}`,
			title: opts.title,
			description: opts.description,
			memberName: opts.participants[0] ?? null,
			priority: opts.priority ?? "medium",
			type: "discussion",
			done: false,
			participants: opts.participants,
		}),
		completeTask: () => {},
		listTasks: () => [],

		createGoal: (opts): Goal => {
			const id = `G${++goalCounter}`;
			const now = new Date().toISOString();
			const goal: Goal = {
				id,
				title: opts.title,
				description: opts.description,
				status: "pending",
				priority: opts.priority ?? "medium",
				parentGoalId: opts.parentGoalId ?? null,
				taskIds: [],
				assignee: opts.assignee ?? null,
				successCriteria: opts.successCriteria ?? "",
				blockers: "",
				createdAt: now,
				updatedAt: now,
			};
			goals.push(goal);
			return goal;
		},
		listGoals: (filter?): Goal[] => {
			if (!filter) return [...goals];
			return goals.filter((g) => {
				if (filter.status && g.status !== filter.status) return false;
				if (filter.parentGoalId !== undefined && g.parentGoalId !== filter.parentGoalId)
					return false;
				if (filter.assignee && g.assignee !== filter.assignee) return false;
				return true;
			});
		},
		updateGoal: (goalId, updates): Goal => {
			const goal = goals.find((g) => g.id === goalId);
			if (!goal) throw new Error(`goal "${goalId}" not found`);
			Object.assign(goal, updates);
			return goal;
		},
		decomposeGoal: (goalId, subGoals): Goal[] => {
			const created: Goal[] = [];
			for (const sub of subGoals) {
				const id = `${goalId}.${created.length + 1}`;
				const now = new Date().toISOString();
				created.push({
					id,
					title: sub.title,
					description: sub.description,
					status: "pending",
					priority: sub.priority ?? "medium",
					parentGoalId: goalId,
					taskIds: [],
					assignee: null,
					successCriteria: sub.successCriteria ?? "",
					blockers: "",
					createdAt: now,
					updatedAt: now,
				});
			}
			goals.push(...created);
			return created;
		},
		linkTaskToGoal: () => {},

		requestTask: (): TaskState | null => {
			const task: TaskState = {
				id: `T${++taskCounter}`,
				title: "Auto-assigned task",
				description: "From goal backlog",
				memberName: "requester",
				priority: "medium",
				type: "execution",
				done: false,
			};
			return task;
		},

		writeMemory: () => Promise.resolve(),
		readMemberIndex: () => null,
		readTopicFile: () => null,
		readTeamMd: () => ({
			mission: "",
			goals,
			members: [],
			activeTasks: [],
			importantNotes: "",
			sharedMemoryIndex: [],
		}),
		pauseMember: () => {},
		resumeMember: () => {},
		cancelMember: () => {},
		directMember: () => {},
		sendMessage: () => ({ message: {} as never, delivery: "persist-only" }),
		broadcastMessage: () => [],
		readInbox: () => [],
		markInboxRead: () => 0,
		getMaxWorkers: () => 5,
		isSelfMember: () => false,
		getSelfMemberName: () => undefined,
		dispose: () => Promise.resolve(),
		subscribe: () => () => {},
	};

	return manager;
}

async function executeTeam(
	manager: TeamManagerLike,
	params: Record<string, unknown>,
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
	const tool = createTeamTool({ teamRef: { current: manager } });
	return (await tool.execute(
		"test",
		params as never,
		undefined as never,
		undefined as never,
		undefined as never,
	)) as { content: Array<{ type: string; text: string }>; isError?: boolean };
}

describe("team tool — goal actions (black-box)", () => {
	it("goal-create returns success with goal ID", async () => {
		const manager = createGoalMockManager();
		const result = await executeTeam(manager, {
			action: "goal-create",
			title: "Ship v1",
			description: "First release",
			priority: "high",
			successCriteria: "All tests pass",
		});
		expect(result.isError).toBeFalsy();
		expect(result.content[0].text).toContain("G1");
		expect(result.content[0].text).toContain("Ship v1");
	});

	it("goal-create requires title", async () => {
		const manager = createGoalMockManager();
		const result = await executeTeam(manager, {
			action: "goal-create",
			description: "No title",
		});
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("title is required");
	});

	it("goal-list returns formatted goals", async () => {
		const manager = createGoalMockManager();
		await executeTeam(manager, {
			action: "goal-create",
			title: "First",
			description: "",
			priority: "high",
		});
		await executeTeam(manager, {
			action: "goal-create",
			title: "Second",
			description: "",
		});
		const result = await executeTeam(manager, { action: "goal-list" });
		expect(result.isError).toBeFalsy();
		expect(result.content[0].text).toContain("First");
		expect(result.content[0].text).toContain("Second");
	});

	it("goal-list with no goals returns friendly message", async () => {
		const manager = createGoalMockManager();
		const result = await executeTeam(manager, { action: "goal-list" });
		expect(result.content[0].text).toContain("No goals found");
	});

	it("goal-update changes status", async () => {
		const manager = createGoalMockManager();
		await executeTeam(manager, {
			action: "goal-create",
			title: "Test",
			description: "",
		});
		const result = await executeTeam(manager, {
			action: "goal-update",
			goalId: "G1",
			goalStatus: "in_progress",
		});
		expect(result.isError).toBeFalsy();
		expect(result.content[0].text).toContain("in_progress");
	});

	it("goal-update requires goalId", async () => {
		const manager = createGoalMockManager();
		const result = await executeTeam(manager, {
			action: "goal-update",
			goalStatus: "completed",
		});
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("goalId is required");
	});

	it("goal-decompose creates sub-goals", async () => {
		const manager = createGoalMockManager();
		await executeTeam(manager, {
			action: "goal-create",
			title: "Big feature",
			description: "",
		});
		const result = await executeTeam(manager, {
			action: "goal-decompose",
			goalId: "G1",
			subGoals: [
				{ title: "Design", description: "API design" },
				{ title: "Implement", description: "Code it" },
				{ title: "Test", description: "Write tests" },
			],
		});
		expect(result.isError).toBeFalsy();
		expect(result.content[0].text).toContain("3 sub-goals");
		expect(result.content[0].text).toContain("G1.1");
		expect(result.content[0].text).toContain("G1.2");
		expect(result.content[0].text).toContain("G1.3");
	});

	it("goal-decompose requires subGoals", async () => {
		const manager = createGoalMockManager();
		await executeTeam(manager, {
			action: "goal-create",
			title: "X",
			description: "",
		});
		const result = await executeTeam(manager, {
			action: "goal-decompose",
			goalId: "G1",
		});
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("subGoals array is required");
	});

	it("request-task returns assigned task", async () => {
		const manager = createGoalMockManager();
		const result = await executeTeam(manager, {
			action: "request-task",
			name: "sasha",
		});
		expect(result.isError).toBeFalsy();
		expect(result.content[0].text).toContain("assigned to you");
	});

	it("request-task requires name", async () => {
		const manager = createGoalMockManager();
		const result = await executeTeam(manager, { action: "request-task" });
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("name");
	});

	it("read action includes goals section", async () => {
		const manager = createGoalMockManager();
		await executeTeam(manager, {
			action: "goal-create",
			title: "Visible goal",
			description: "",
			priority: "high",
		});
		const result = await executeTeam(manager, { action: "read" });
		expect(result.content[0].text).toContain("Goals:");
		expect(result.content[0].text).toContain("Visible goal");
		expect(result.content[0].text).toContain("[high]");
	});
});
