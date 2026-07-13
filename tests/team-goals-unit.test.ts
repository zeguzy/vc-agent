import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseGoals, serializeGoals, TeamFiles } from "../src/teams/files.js";
import type { Goal } from "../src/teams/types-v2.js";

describe("parseGoals", () => {
	it("parses a single top-level goal", () => {
		const raw = "- [pending] G1: Build auth system [high] @leader";
		const goals = parseGoals(raw);
		expect(goals).toHaveLength(1);
		expect(goals[0].id).toBe("G1");
		expect(goals[0].title).toBe("Build auth system");
		expect(goals[0].status).toBe("pending");
		expect(goals[0].priority).toBe("high");
		expect(goals[0].assignee).toBe("leader");
		expect(goals[0].parentGoalId).toBeNull();
	});

	it("parses nested goals with correct parentGoalId", () => {
		const raw = [
			"- [pending] G1: Parent goal [high]",
			"  - [in_progress] G1.1: Child A [medium] @sasha",
			"  - [completed] G1.2: Child B [low] → T1",
		].join("\n");
		const goals = parseGoals(raw);
		expect(goals).toHaveLength(3);
		expect(goals[0].id).toBe("G1");
		expect(goals[0].parentGoalId).toBeNull();
		expect(goals[1].id).toBe("G1.1");
		expect(goals[1].parentGoalId).toBe("G1");
		expect(goals[2].id).toBe("G1.2");
		expect(goals[2].parentGoalId).toBe("G1");
		expect(goals[2].taskIds).toEqual(["T1"]);
	});

	it("parses Description, Success, and Blocked lines", () => {
		const raw = [
			"- [blocked] G1: Blocked goal [high]",
			"  Description: Full description here",
			"  Success: It works end to end",
			"  Blocked: Waiting for dependency",
		].join("\n");
		const goals = parseGoals(raw);
		expect(goals).toHaveLength(1);
		expect(goals[0].description).toBe("Full description here");
		expect(goals[0].successCriteria).toBe("It works end to end");
		expect(goals[0].blockers).toBe("Waiting for dependency");
	});

	it("parses multiple top-level goals", () => {
		const raw = [
			"- [pending] G1: First [high]",
			"- [completed] G2: Second [medium]",
		].join("\n");
		const goals = parseGoals(raw);
		expect(goals).toHaveLength(2);
		expect(goals[0].parentGoalId).toBeNull();
		expect(goals[1].parentGoalId).toBeNull();
	});

	it("parses taskIds links", () => {
		const raw = "- [in_progress] G1: Goal with tasks [high] → T1,T2,T3";
		const goals = parseGoals(raw);
		expect(goals[0].taskIds).toEqual(["T1", "T2", "T3"]);
	});

	it("returns empty array for empty input", () => {
		expect(parseGoals("")).toEqual([]);
		expect(parseGoals("  \n  ")).toEqual([]);
	});

	it("defaults priority to medium when not specified", () => {
		const goals = parseGoals("- [pending] G1: No priority specified");
		expect(goals[0].priority).toBe("medium");
	});

	it("defaults assignee to null when not specified", () => {
		const goals = parseGoals("- [pending] G1: No assignee [high]");
		expect(goals[0].assignee).toBeNull();
	});
});

describe("serializeGoals", () => {
	it("serializes a single goal", () => {
		const goals: Goal[] = [
			{
				id: "G1",
				title: "Test goal",
				description: "",
				status: "pending",
				priority: "high",
				parentGoalId: null,
				taskIds: [],
				assignee: "leader",
				successCriteria: "",
				blockers: "",
				createdAt: "2025-01-01T00:00:00.000Z",
				updatedAt: "2025-01-01T00:00:00.000Z",
			},
		];
		const raw = serializeGoals(goals);
		expect(raw).toContain("- [pending] G1: Test goal [high] @leader");
	});

	it("serializes nested goals with indentation", () => {
		const goals: Goal[] = [
			{
				id: "G1",
				title: "Parent",
				description: "",
				status: "pending",
				priority: "high",
				parentGoalId: null,
				taskIds: [],
				assignee: null,
				successCriteria: "",
				blockers: "",
				createdAt: "2025-01-01T00:00:00.000Z",
				updatedAt: "2025-01-01T00:00:00.000Z",
			},
			{
				id: "G1.1",
				title: "Child",
				description: "",
				status: "in_progress",
				priority: "medium",
				parentGoalId: "G1",
				taskIds: ["T1"],
				assignee: "sasha",
				successCriteria: "Done",
				blockers: "",
				createdAt: "2025-01-01T00:00:00.000Z",
				updatedAt: "2025-01-01T00:00:00.000Z",
			},
		];
		const raw = serializeGoals(goals);
		expect(raw).toContain("- [pending] G1: Parent [high]");
		expect(raw).toContain("  - [in_progress] G1.1: Child [medium] @sasha → T1");
		expect(raw).toContain("  Success: Done");
	});

	it("serializes Description, Success, and Blocked", () => {
		const goals: Goal[] = [
			{
				id: "G1",
				title: "Blocked goal",
				description: "Detailed desc",
				status: "blocked",
				priority: "high",
				parentGoalId: null,
				taskIds: [],
				assignee: null,
				successCriteria: "Success criteria",
				blockers: "Dependency missing",
				createdAt: "2025-01-01T00:00:00.000Z",
				updatedAt: "2025-01-01T00:00:00.000Z",
			},
		];
		const raw = serializeGoals(goals);
		expect(raw).toContain("Description: Detailed desc");
		expect(raw).toContain("Success: Success criteria");
		expect(raw).toContain("Blocked: Dependency missing");
	});

	it("returns empty string for empty array", () => {
		expect(serializeGoals([])).toBe("");
	});
});

describe("parseGoals ∘ serializeGoals round-trip", () => {
	it("preserves goal structure through round-trip", () => {
		const original: Goal[] = [
			{
				id: "G1",
				title: "Build feature",
				description: "Complete feature implementation",
				status: "in_progress",
				priority: "high",
				parentGoalId: null,
				taskIds: ["T1", "T2"],
				assignee: "leader",
				successCriteria: "All tests pass",
				blockers: "",
				createdAt: "2025-01-01T00:00:00.000Z",
				updatedAt: "2025-01-01T00:00:00.000Z",
			},
			{
				id: "G1.1",
				title: "Design API",
				description: "",
				status: "completed",
				priority: "medium",
				parentGoalId: "G1",
				taskIds: ["T1"],
				assignee: "sasha",
				successCriteria: "",
				blockers: "",
				createdAt: "2025-01-01T00:00:00.000Z",
				updatedAt: "2025-01-01T00:00:00.000Z",
			},
			{
				id: "G2",
				title: "Optimize",
				description: "",
				status: "blocked",
				priority: "low",
				parentGoalId: null,
				taskIds: [],
				assignee: null,
				successCriteria: "",
				blockers: "Waiting for G1",
				createdAt: "2025-01-01T00:00:00.000Z",
				updatedAt: "2025-01-01T00:00:00.000Z",
			},
		];
		const serialized = serializeGoals(original);
		const parsed = parseGoals(serialized);

		expect(parsed).toHaveLength(3);
		expect(parsed[0].id).toBe("G1");
		expect(parsed[0].title).toBe("Build feature");
		expect(parsed[0].status).toBe("in_progress");
		expect(parsed[0].priority).toBe("high");
		expect(parsed[0].assignee).toBe("leader");
		expect(parsed[0].taskIds).toEqual(["T1", "T2"]);
		expect(parsed[0].parentGoalId).toBeNull();
		expect(parsed[0].description).toBe("Complete feature implementation");
		expect(parsed[0].successCriteria).toBe("All tests pass");

		expect(parsed[1].id).toBe("G1.1");
		expect(parsed[1].parentGoalId).toBe("G1");
		expect(parsed[1].status).toBe("completed");

		expect(parsed[2].id).toBe("G2");
		expect(parsed[2].status).toBe("blocked");
		expect(parsed[2].blockers).toBe("Waiting for G1");
	});
});

describe("TeamFiles goal persistence", () => {
	let tmpDir: string;
	let files: TeamFiles;

	beforeAll(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "team-goals-"));
		files = new TeamFiles(tmpDir);
		files.initTeamDir();
	});

	afterAll(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("writes and reads goals through TEAM.md", () => {
		const teamMd = files.readTeamMd();
		teamMd.mission = "Test mission";
		teamMd.goals = [
			{
				id: "G1",
				title: "Top goal",
				description: "Desc",
				status: "pending",
				priority: "high",
				parentGoalId: null,
				taskIds: [],
				assignee: "leader",
				successCriteria: "Done",
				blockers: "",
				createdAt: "2025-01-01T00:00:00.000Z",
				updatedAt: "2025-01-01T00:00:00.000Z",
			},
		];
		files.writeTeamMd(teamMd);

		const reRead = files.readTeamMd();
		expect(reRead.goals).toHaveLength(1);
		expect(reRead.goals[0].id).toBe("G1");
		expect(reRead.goals[0].title).toBe("Top goal");
		expect(reRead.goals[0].priority).toBe("high");
		expect(reRead.goals[0].assignee).toBe("leader");
		expect(reRead.goals[0].successCriteria).toBe("Done");
	});

	it("handles empty goals array", () => {
		const teamMd = files.readTeamMd();
		teamMd.goals = [];
		files.writeTeamMd(teamMd);

		const reRead = files.readTeamMd();
		expect(reRead.goals).toEqual([]);
	});
});
