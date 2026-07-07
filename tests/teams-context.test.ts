import { describe, expect, it } from "bun:test";
import {
	buildCompactionReinject,
	buildContractLayer,
	buildIdentityLayer,
	buildIndexLayer,
	buildMemberSystemPrompt,
	buildRuntimeLayer,
	buildTeamStaticLayer,
	buildToolContractLayer,
} from "../src/teams/context.js";
import type { MemberIndexStructure, TaskState, TeamMdStructure } from "../src/teams/types-v2.js";

const emptyTeamMd: TeamMdStructure = {
	mission: "",
	members: [],
	activeTasks: [],
	importantNotes: "",
	sharedMemoryIndex: [],
};

const sampleMemberIndex: MemberIndexStructure = {
	profile: { role: "reviewer", goal: "审查" },
	activeContext: "",
	memoryIndex: [],
	recentActivity: [],
};

const sampleTask: TaskState = {
	id: "T1",
	title: "Fix auth bug",
	description: "The login endpoint returns 500",
	memberName: "alice",
	priority: "high",
	done: false,
};

describe("buildContractLayer", () => {
	it("contains all contract sections without constraints", () => {
		const layer = buildContractLayer({ name: "alice", role: "reviewer", goal: "审查代码" });

		expect(layer).toContain("You are alice, a reviewer on this team.");
		expect(layer).toContain("Your goal: 审查代码");
		expect(layer).toContain("## Anti-Patterns");
		expect(layer).toContain("## When to Stop and Escalate");
		expect(layer).toContain("## How to Report Back");
	});

	it("does not show constraints pointer when no constraints provided", () => {
		const layer = buildContractLayer({ name: "x", role: "y", goal: "z" });
		expect(layer).not.toContain("Anti-Patterns section below");
	});

	it("injects constraints only into Anti-Patterns when provided", () => {
		const constraints = "must run tests; no rubber-stamping";
		const layer = buildContractLayer({
			name: "bob",
			role: "implementer",
			goal: "ship",
			constraints,
		});

		expect(layer).toContain("must run tests; no rubber-stamping");
		expect(layer).toContain("Specific to your assignment");
		expect(layer).toContain("Anti-Patterns section below");
	});

	it("ensures constraints text appears exactly once", () => {
		const constraints = "UNIQUE_CONSTRAINT_MARKER_42";
		const layer = buildContractLayer({ name: "x", role: "y", goal: "z", constraints });
		const matches = layer.match(/UNIQUE_CONSTRAINT_MARKER_42/g);
		expect(matches?.length).toBe(1);
	});

	it("treats empty/whitespace constraints as no constraints", () => {
		const layer = buildContractLayer({ name: "x", role: "y", goal: "z", constraints: "   \n\n  " });
		expect(layer).not.toContain("Anti-Patterns section below");
		expect(layer).not.toContain("Specific to your assignment");
	});

	it("includes Reading is not verification in Anti-Patterns", () => {
		const layer = buildContractLayer({ name: "x", role: "y", goal: "z" });
		expect(layer).toContain("Reading is not verification");
	});

	it("includes universal anti-patterns", () => {
		const layer = buildContractLayer({ name: "x", role: "y", goal: "z" });
		expect(layer).toContain("Scope creep");
		expect(layer).toContain("Reporting without verification");
		expect(layer).toContain("Redoing the leader's work");
		expect(layer).toContain("Touching team files directly");
	});
});

describe("buildToolContractLayer", () => {
	it("includes tool list", () => {
		const layer = buildToolContractLayer({ tools: ["read", "bash", "memory", "message"] });
		expect(layer).toContain("`read`");
		expect(layer).toContain("`bash`");
		expect(layer).not.toContain("`edit`");
	});

	it("includes work discipline section", () => {
		const layer = buildToolContractLayer({ tools: ["read"] });
		expect(layer).toContain("## How You Work");
	});

	it("lists assigned skills when given", () => {
		const layer = buildToolContractLayer({
			tools: ["read"],
			skills: ["backend-conventions", "testing"],
		});
		expect(layer).toContain("`backend-conventions`");
		expect(layer).toContain("`testing`");
	});

	it("lists MCP servers when mcp tool is included", () => {
		const layer = buildToolContractLayer({
			tools: ["read", "mcp"],
			mcps: ["postgres", "github"],
		});
		expect(layer).toContain("`postgres`");
		expect(layer).toContain("`github`");
	});

	it("omits MCP section when mcp tool not in tools", () => {
		const layer = buildToolContractLayer({ tools: ["read"], mcps: ["postgres"] });
		expect(layer).not.toContain("`postgres`");
	});

	it("does not include per-tool usage bullets", () => {
		const layer = buildToolContractLayer({ tools: ["read", "edit", "write", "bash"] });
		expect(layer).not.toContain("Use `edit` for targeted changes");
		expect(layer).not.toContain("Use `read` to understand code");
	});
});

describe("buildTeamStaticLayer", () => {
	it("includes mission and members with currentTask", () => {
		const teamMd: TeamMdStructure = {
			mission: "Ship the product",
			members: [
				{ name: "alice", role: "dev", status: "active", currentTask: "T1" },
				{ name: "bob", role: "qa", status: "idle", currentTask: "" },
			],
			activeTasks: [sampleTask],
			importantNotes: "Deploy Friday",
			sharedMemoryIndex: [],
		};
		const layer = buildTeamStaticLayer(teamMd, "alice");

		expect(layer).toContain("Mission: Ship the product");
		expect(layer).toContain("alice (dev) — active — T1");
		expect(layer).toContain("→ alice");
		expect(layer).toContain("bob (qa) — idle");
		expect(layer).not.toContain("Important:");
	});

	it("omits active tasks and important notes (those go to Index layer)", () => {
		const teamMd: TeamMdStructure = {
			mission: "Test",
			members: [],
			activeTasks: [sampleTask],
			importantNotes: "Deploy Friday",
			sharedMemoryIndex: [],
		};
		const layer = buildTeamStaticLayer(teamMd);
		expect(layer).not.toContain("Active Tasks:");
		expect(layer).not.toContain("Important:");
	});
});

describe("buildRuntimeLayer", () => {
	it("includes current task when provided", () => {
		const layer = buildRuntimeLayer({ currentTask: sampleTask });
		expect(layer).toContain("Task: T1: Fix auth bug");
		expect(layer).toContain("The login endpoint returns 500");
		expect(layer).toContain("Priority: high");
	});

	it("includes active context when no task", () => {
		const layer = buildRuntimeLayer({ activeContext: "Working on auth" });
		expect(layer).toContain("Focus: Working on auth");
	});

	it("includes recent activity", () => {
		const layer = buildRuntimeLayer({
			recentActivity: [
				{ date: "2025-01-01", entry: "Fixed login" },
				{ date: "2025-01-02", entry: "Added tests" },
			],
		});
		expect(layer).toContain("Fixed login");
		expect(layer).toContain("Added tests");
	});

	it("limits recent activity to last 5", () => {
		const activities = Array.from({ length: 7 }, (_, i) => ({
			date: `2025-01-${i + 1}`,
			entry: `Entry ${i + 1}`,
		}));
		const layer = buildRuntimeLayer({ recentActivity: activities });
		expect(layer).toContain("Entry 7");
		expect(layer).not.toContain("Entry 1");
		expect(layer).not.toContain("Entry 2");
	});

	it("prefers current task over active context when both present", () => {
		const layer = buildRuntimeLayer({ currentTask: sampleTask, activeContext: "Old context" });
		expect(layer).toContain("Task: T1");
		expect(layer).not.toContain("Focus:");
	});
});

describe("buildIndexLayer", () => {
	it("includes active tasks and memory index", () => {
		const layer = buildIndexLayer({
			memoryIndex: [{ file: "auth-patterns", type: "project", description: "Auth flow" }],
			activeTasks: [sampleTask],
			importantNotes: "Deploy Friday",
		});
		expect(layer).toContain("Active Tasks:");
		expect(layer).toContain("○ T1: Fix auth bug → @alice");
		expect(layer).toContain("Memories:");
		expect(layer).toContain("auth-patterns [project] — Auth flow");
		expect(layer).toContain("Important: Deploy Friday");
	});

	it("handles empty index gracefully", () => {
		const layer = buildIndexLayer({ memoryIndex: [], activeTasks: [] });
		expect(layer).not.toContain("Active Tasks:");
		expect(layer).not.toContain("Memories:");
	});
});

describe("buildMemberSystemPrompt", () => {
	it("returns five-element array [A, B, C, D, E]", () => {
		const prompts = buildMemberSystemPrompt({
			name: "alice",
			role: "reviewer",
			goal: "审查",
			memberIndex: sampleMemberIndex,
			teamMd: emptyTeamMd,
			selfName: "alice",
		});

		expect(prompts.length).toBe(5);
		expect(prompts[0]).toContain("You are alice");
		expect(prompts[0]).toContain("## Anti-Patterns");
		expect(prompts[1]).toContain("## Your Tools");
		expect(prompts[2]).toContain("Team Overview");
		expect(prompts[3]).toContain("Your Current State");
		expect(prompts[4]).toContain("Indexes");
	});

	it("Layer A carries constraints when provided", () => {
		const prompts = buildMemberSystemPrompt({
			name: "bob",
			role: "implementer",
			goal: "ship",
			constraints: "MUST_PASS_TESTS",
			memberIndex: null,
			teamMd: emptyTeamMd,
			selfName: "bob",
		});

		expect(prompts[0]).toContain("MUST_PASS_TESTS");
		expect(prompts[0]).toContain("Anti-Patterns section below");
	});

	it("Layer D includes current task for the member", () => {
		const teamMd: TeamMdStructure = {
			...emptyTeamMd,
			activeTasks: [{ ...sampleTask, memberName: "alice" }],
		};
		const prompts = buildMemberSystemPrompt({
			name: "alice",
			role: "dev",
			goal: "code",
			memberIndex: sampleMemberIndex,
			teamMd,
			selfName: "alice",
		});

		expect(prompts[3]).toContain("Task: T1: Fix auth bug");
	});

	it("Layer E includes memory index and task overview", () => {
		const teamMd: TeamMdStructure = {
			...emptyTeamMd,
			activeTasks: [{ ...sampleTask, memberName: "alice" }],
		};
		const memberIndex: MemberIndexStructure = {
			...sampleMemberIndex,
			memoryIndex: [{ file: "patterns", type: "project", description: "Code patterns" }],
		};
		const prompts = buildMemberSystemPrompt({
			name: "alice",
			role: "dev",
			goal: "code",
			memberIndex,
			teamMd,
			selfName: "alice",
		});

		expect(prompts[4]).toContain("patterns [project] — Code patterns");
		expect(prompts[4]).toContain("○ T1: Fix auth bug → @alice");
	});
});

describe("buildCompactionReinject", () => {
	it("includes contract (Layer A) in reinject", () => {
		const reinject = buildCompactionReinject({
			name: "alice",
			role: "reviewer",
			goal: "审查",
			memberIndex: sampleMemberIndex,
			teamMd: emptyTeamMd,
			selfName: "alice",
		});

		expect(reinject).toContain("[Contract Re-injected]");
		expect(reinject).toContain("You are alice");
		expect(reinject).toContain("## Anti-Patterns");
	});

	it("includes team static (Layer C) in reinject", () => {
		const reinject = buildCompactionReinject({
			name: "alice",
			role: "reviewer",
			goal: "审查",
			memberIndex: sampleMemberIndex,
			teamMd: emptyTeamMd,
			selfName: "alice",
		});

		expect(reinject).toContain("[Team Overview Re-injected]");
	});

	it("includes runtime (Layer D) in reinject", () => {
		const reinject = buildCompactionReinject({
			name: "alice",
			role: "reviewer",
			goal: "审查",
			memberIndex: sampleMemberIndex,
			teamMd: emptyTeamMd,
			selfName: "alice",
		});

		expect(reinject).toContain("[Your Current State Re-injected]");
	});
});

describe("buildIdentityLayer (legacy)", () => {
	it("still works for backward compatibility", () => {
		const l1 = buildIdentityLayer({ name: "alice", role: "reviewer", goal: "审查代码" });
		expect(l1).toContain("You are alice, a reviewer on this team.");
		expect(l1).toContain("## Anti-Patterns");
		expect(l1).toContain("## Your Tools");
		expect(l1).toContain("## How You Work");
	});
});
