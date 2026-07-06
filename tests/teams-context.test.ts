import { describe, expect, it } from "bun:test";
import { buildIdentityLayer, buildMemberSystemPrompt } from "../src/teams/context.js";
import type { TeamMdStructure } from "../src/teams/types-v2.js";

const emptyTeamMd: TeamMdStructure = {
	mission: "",
	members: [],
	activeTasks: [],
	importantNotes: "",
	sharedMemoryIndex: [],
};

describe("buildIdentityLayer", () => {
	it("contains all seven sections without constraints", () => {
		const l1 = buildIdentityLayer({ name: "alice", role: "reviewer", goal: "审查代码" });

		expect(l1).toContain("You are alice, a reviewer on this team.");
		expect(l1).toContain("Your goal: 审查代码");
		expect(l1).toContain("## Your Capabilities");
		expect(l1).toContain("## How You Work");
		expect(l1).toContain("## Anti-Patterns");
		expect(l1).toContain("## When to Stop and Escalate");
		expect(l1).toContain("## How to Report Back");
		expect(l1).toContain("## When to Write Memory");
	});

	it("includes universal fallback anti-patterns without constraints", () => {
		const l1 = buildIdentityLayer({ name: "x", role: "y", goal: "z" });

		expect(l1).toContain("Scope creep");
		expect(l1).toContain("Reporting without verification");
		expect(l1).toContain("Redoing the leader's work");
		expect(l1).toContain("Touching team files directly");
		expect(l1).toContain("Reading is not verification");
	});

	it("does not contain agentSystemPrompt traces (dead param removed)", () => {
		const l1 = buildIdentityLayer({ name: "x", role: "y", goal: "z" });
		expect(l1).not.toContain("agentSystemPrompt");
	});

	it("does not show constraints pointer when no constraints provided", () => {
		const l1 = buildIdentityLayer({ name: "x", role: "y", goal: "z" });
		expect(l1).not.toContain("Anti-Patterns section below");
	});

	it("injects constraints only into Anti-Patterns when provided", () => {
		const constraints = "must run tests; no rubber-stamping";
		const l1 = buildIdentityLayer({ name: "bob", role: "implementer", goal: "ship", constraints });

		expect(l1).toContain("must run tests; no rubber-stamping");
		expect(l1).toContain("Specific to your assignment");
		expect(l1).toContain("Anti-Patterns section below");
	});

	it("ensures constraints text appears exactly once (not duplicated in Identity)", () => {
		const constraints = "UNIQUE_CONSTRAINT_MARKER_42";
		const l1 = buildIdentityLayer({ name: "x", role: "y", goal: "z", constraints });
		const matches = l1.match(/UNIQUE_CONSTRAINT_MARKER_42/g);
		expect(matches?.length).toBe(1);
	});

	it("treats empty/whitespace constraints as no constraints", () => {
		const l1 = buildIdentityLayer({ name: "x", role: "y", goal: "z", constraints: "   \n\n  " });
		expect(l1).not.toContain("Anti-Patterns section below");
		expect(l1).not.toContain("Specific to your assignment");
	});
});

describe("buildMemberSystemPrompt", () => {
	it("returns three-element array [L1, L2, L3]", () => {
		const prompts = buildMemberSystemPrompt({
			name: "alice",
			role: "reviewer",
			goal: "审查",
			memberIndex: {
				profile: { role: "reviewer", goal: "审查" },
				activeContext: "",
				memoryIndex: [],
				recentActivity: [],
			},
			teamMd: emptyTeamMd,
			selfName: "alice",
		});

		expect(prompts.length).toBe(3);
		expect(prompts[0]).toContain("You are alice");
		expect(prompts[0]).toContain("## Your Capabilities");
		expect(prompts[1]).toContain("Memory Index");
		expect(prompts[2]).toContain("Team Summary");
	});

	it("L1 carries constraints when provided", () => {
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
});
