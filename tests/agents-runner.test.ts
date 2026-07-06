import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BUILTIN_AGENTS } from "../src/agents/defaults.js";

const runnerSrc = readFileSync(join(import.meta.dirname, "../src/agents/runner.ts"), "utf-8");

const READONLY_AGENTS = ["flagella", "nucleus", "plasmid", "lysosome"];

describe("runSubagent readonly agents get noContextFiles/noSkills/noExtensions", () => {
	for (const name of READONLY_AGENTS) {
		it(`${name} ResourceLoader gets all three flags`, () => {
			const agent = BUILTIN_AGENTS.find((a) => a.name === name);
			expect(agent).toBeDefined();
			expect(runnerSrc).toContain("noContextFiles: true");
			expect(runnerSrc).toContain("noSkills: true");
			expect(runnerSrc).toContain("noExtensions: true");
		});
	}

	it("all four readonly agents are covered (regression guard)", () => {
		const covered = READONLY_AGENTS.every((name) => BUILTIN_AGENTS.some((a) => a.name === name));
		expect(covered).toBe(true);
		expect(READONLY_AGENTS.length).toBe(4);
	});

	it("noContextFiles flag exists in runner source (unified for all subagents)", () => {
		expect(runnerSrc).toMatch(/noContextFiles:\s*true/);
	});
});
