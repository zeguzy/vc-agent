import { describe, expect, it } from "bun:test";
import { BUILTIN_AGENTS } from "../src/agents/defaults.js";

function getAgent(name: string) {
	const agent = BUILTIN_AGENTS.find((a) => a.name === name);
	if (!agent) throw new Error(`agent "${name}" not found in BUILTIN_AGENTS`);
	return agent;
}

describe("lysosome adversarial verification prompt", () => {
	const lysosome = getAgent("lysosome");
	const prompt = lysosome.systemPrompt;

	it("declares adversarial philosophy (try to break, not confirm)", () => {
		expect(prompt).toContain("try to BREAK it");
		expect(prompt).toContain("independent verifier");
		expect(prompt).toContain("Reading is not verification");
	});

	it("requires VERDICT line with PASS | FAIL | PARTIAL", () => {
		expect(prompt).toContain("VERDICT: PASS | FAIL | PARTIAL");
		expect(prompt).toMatch(/VERDICT:\s*PASS\s*\|\s*FAIL\s*\|\s*PARTIAL/);
	});

	it("marks VERDICT line as REQUIRED", () => {
		expect(prompt).toMatch(/REQUIRED/i);
		expect(prompt).toMatch(/invalid without this line/i);
	});

	it("lists all 6 self-rationalization anti-patterns", () => {
		expect(prompt).toContain("The code looks correct");
		expect(prompt).toContain("The logic seems sound");
		expect(prompt).toContain("Tests should pass");
		expect(prompt).toContain("Edge cases are handled");
		expect(prompt).toContain("No security concerns");
		expect(prompt).toContain("Type-safe");
	});

	it("requires Evidence section with actual commands for PASS", () => {
		expect(prompt).toContain("Evidence");
		expect(prompt).toMatch(/For PASS:.*verifications you ran/is);
		expect(prompt).toContain("tsc");
	});

	it("requires counterexample for FAIL", () => {
		expect(prompt).toMatch(/For FAIL:.*counterexample/is);
	});

	it("requires PARTIAL when tooling unavailable", () => {
		expect(prompt).toMatch(/For PARTIAL:/);
		expect(prompt).toMatch(/unverified/i);
	});

	it("does NOT contain legacy APPROVE/REQUEST_CHANGES/NEEDS_DISCUSSION", () => {
		expect(prompt).not.toContain("APPROVE");
		expect(prompt).not.toContain("REQUEST_CHANGES");
		expect(prompt).not.toContain("NEEDS_DISCUSSION");
	});

	it("auto-fails on 'looks good' without evidence", () => {
		expect(prompt).toMatch(/Looks good.*without evidence.*automatic FAIL/i);
	});

	it("never approves type error suppressions", () => {
		expect(prompt).toContain("as any");
		expect(prompt).toContain("@ts-ignore");
		expect(prompt).toMatch(/Never approve type safety.*as any.*@ts-ignore/is);
	});

	it("description reflects adversarial verification role", () => {
		const desc = lysosome.description.toLowerCase();
		const hasAdversarial = desc.includes("adversarial") || desc.includes("verification");
		expect(hasAdversarial).toBe(true);
	});
});
