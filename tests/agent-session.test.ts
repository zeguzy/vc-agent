import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { appendSystemPromptFor } from "../src/agent/session.js";
import { BUILTIN_AGENTS } from "../src/agents/defaults.js";
import { buildAvailableAgentsPrompt, discoverAgents } from "../src/agents/discover.js";

const tmpBase = join(import.meta.dirname, ".tmp-test-agent-session");

describe("buildAvailableAgentsPrompt", () => {
	it("produces markdown section with header", () => {
		const prompt = buildAvailableAgentsPrompt(BUILTIN_AGENTS);
		expect(prompt).toMatch(/## Available subagents/i);
	});

	it("lists every agent name in bold", () => {
		const prompt = buildAvailableAgentsPrompt(BUILTIN_AGENTS);
		for (const a of BUILTIN_AGENTS) {
			expect(prompt).toContain(`**${a.name}**`);
		}
	});

	it("includes first line of description per agent", () => {
		const prompt = buildAvailableAgentsPrompt(BUILTIN_AGENTS);
		const flagella = BUILTIN_AGENTS.find((a) => a.name === "flagella")!;
		expect(prompt).toContain(flagella.description.split("\n")[0]);
	});

	it("returns empty string for empty list", () => {
		expect(buildAvailableAgentsPrompt([])).toBe("");
	});
});

describe("appendSystemPromptFor agent list injection", () => {
	beforeAll(() => {
		rmSync(tmpBase, { recursive: true, force: true });
		mkdirSync(tmpBase, { recursive: true });
	});
	afterAll(() => {
		rmSync(tmpBase, { recursive: true, force: true });
	});

	it("standard mode with cwd injects agent list", () => {
		const result = appendSystemPromptFor("standard", {}, tmpBase);
		expect(result).toBeDefined();
		expect(result!.some((p) => p.includes("Available subagents"))).toBe(true);
	});

	it("orchestrator mode with cwd injects agent list", () => {
		const result = appendSystemPromptFor("orchestrator", {}, tmpBase);
		expect(result).toBeDefined();
		expect(result!.some((p) => p.includes("Available subagents"))).toBe(true);
	});

	it("planner mode does not inject agent list", () => {
		const result = appendSystemPromptFor("planner", {}, tmpBase);
		expect(result?.some((p) => p.includes("Available subagents"))).toBeFalsy();
	});

	it("team mode does not inject agent list (uses team tool, not subagent)", () => {
		const result = appendSystemPromptFor("team", { teams: { enabled: true } }, tmpBase);
		expect(result?.some((p) => p.includes("Available subagents"))).toBeFalsy();
	});

	it("standard mode without cwd does not inject agent list (backward compat)", () => {
		const result = appendSystemPromptFor("standard", {});
		expect(result?.some((p) => p.includes("Available subagents"))).toBeFalsy();
	});

	it("discovered custom agents appear in the list", () => {
		const customDir = join(tmpBase, ".openagent", "agents");
		mkdirSync(customDir, { recursive: true });
		const customPath = join(customDir, "my-custom.md");
		writeFileSync(
			customPath,
			[
				"---",
				'name: "my-custom"',
				'description: "Custom test agent"',
				'tools: "read,bash"',
				"---",
				"You are a custom agent for testing.",
				"",
			].join("\n"),
		);
		const discovered = discoverAgents(tmpBase).agents;
		expect(discovered.some((a) => a.name === "my-custom")).toBe(true);
		const prompt = buildAvailableAgentsPrompt(discovered);
		expect(prompt).toContain("**my-custom**");
		unlinkSync(customPath);
	});
});
