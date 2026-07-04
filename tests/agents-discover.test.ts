import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUILTIN_AGENTS } from "../src/agents/defaults.js";
import { discoverAgents, formatAgentList } from "../src/agents/discover.js";

const BUILTIN_COUNT = BUILTIN_AGENTS.length;

let tempDir: string;

beforeEach(() => {
	tempDir = mkdtempSync(join(tmpdir(), "openagent-test-"));
});

afterEach(() => {
	tempDir = "";
});

function writeProjectAgent(name: string, content: string) {
	const dir = join(tempDir, ".openagent", "agents");
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, `${name}.md`), content, "utf-8");
}

function nonBuiltin(agents: { source: string }[]) {
	return agents.filter((a) => a.source !== "builtin");
}

const VALID_AGENT = (name: string, desc: string) => `---
name: ${name}
description: ${desc}
tools: read, grep, find
---
System prompt for ${name}.
`;

describe("discoverAgents", () => {
	it("returns only builtins when no user/project agents exist", () => {
		const { agents } = discoverAgents(tempDir, "project");
		expect(agents).toHaveLength(BUILTIN_COUNT);
		expect(agents.every((a) => a.source === "builtin")).toBe(true);
	});

	it("discovers project-level agents alongside builtins", () => {
		writeProjectAgent("custom", VALID_AGENT("custom", "Fast recon"));
		const { agents } = discoverAgents(tempDir, "project");
		expect(agents).toHaveLength(BUILTIN_COUNT + 1);
		const custom = agents.find((a) => a.name === "custom")!;
		expect(custom.source).toBe("project");
		expect(custom.systemPrompt).toBe("System prompt for custom.");
		expect(custom.tools).toEqual(["read", "grep", "find"]);
	});

	it("finds project agents in parent directories", () => {
		const parentDir = join(tempDir, "parent");
		const childDir = join(parentDir, "child");
		mkdirSync(join(parentDir, ".openagent", "agents"), { recursive: true });
		mkdirSync(childDir, { recursive: true });
		writeFileSync(
			join(parentDir, ".openagent", "agents", "parent-agent.md"),
			VALID_AGENT("parent-agent", "From parent"),
			"utf-8",
		);

		const { agents } = discoverAgents(childDir, "project");
		expect(nonBuiltin(agents)).toHaveLength(1);
		expect(nonBuiltin(agents)[0].name).toBe("parent-agent");
	});

	it("skips files missing required frontmatter fields", () => {
		writeProjectAgent("incomplete", "---\ndescription: Missing name\n---\nbody\n");
		const { agents } = discoverAgents(tempDir, "project");
		expect(nonBuiltin(agents)).toEqual([]);
		expect(agents).toHaveLength(BUILTIN_COUNT);
	});

	it("skips non-markdown files", () => {
		const dir = join(tempDir, ".openagent", "agents");
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "agent.txt"), VALID_AGENT("txt", "test"), "utf-8");
		const { agents } = discoverAgents(tempDir, "project");
		expect(nonBuiltin(agents)).toEqual([]);
	});

	it("parses optional model field", () => {
		writeProjectAgent(
			"fast",
			"---\nname: fast\ndescription: Fast agent\nmodel: claude-haiku-4-5\n---\nbody\n",
		);
		const { agents } = discoverAgents(tempDir, "project");
		const fast = agents.find((a) => a.name === "fast")!;
		expect(fast.model).toBe("claude-haiku-4-5");
		expect(fast.tools).toBeUndefined();
	});

	it("project agent overrides builtin by name", () => {
		writeProjectAgent("flagella", VALID_AGENT("flagella", "Overridden"));
		const { agents } = discoverAgents(tempDir, "project");
		const flagella = agents.find((a) => a.name === "flagella")!;
		expect(flagella.source).toBe("project");
		expect(flagella.description).toBe("Overridden");
	});

	it("parses disallowedTools, maxTurns, background, permissionMode frontmatter", () => {
		writeProjectAgent(
			"worker",
			[
				"---",
				"name: worker",
				"description: Background worker",
				"tools: read, grep, find",
				"disallowedTools:",
				"  - edit",
				"  - write",
				"maxTurns: 12",
				"background: true",
				"permissionMode: plan",
				"---",
				"body",
				"",
			].join("\n"),
		);
		const { agents } = discoverAgents(tempDir, "project");
		const worker = agents.find((a) => a.name === "worker")!;
		expect(worker.disallowedTools).toEqual(["edit", "write"]);
		expect(worker.maxTurns).toBe(12);
		expect(worker.background).toBe(true);
		expect(worker.permissionMode).toBe("plan");
	});

	it("ignores invalid permissionMode and warns on stderr", () => {
		writeProjectAgent(
			"badperm",
			"---\nname: badperm\ndescription: Bad\npermissionMode: bypass\n---\nbody\n",
		);
		const { agents } = discoverAgents(tempDir, "project");
		const badperm = agents.find((a) => a.name === "badperm")!;
		expect(badperm.permissionMode).toBeUndefined();
	});

	it("skips non-finite maxTurns and non-array disallowedTools", () => {
		writeProjectAgent(
			"weird",
			"---\nname: weird\ndescription: Weird\nmaxTurns: Infinity\ndisallowedTools: not-a-list\n---\nbody\n",
		);
		const { agents } = discoverAgents(tempDir, "project");
		const weird = agents.find((a) => a.name === "weird")!;
		expect(weird.maxTurns).toBeUndefined();
		expect(weird.disallowedTools).toBeUndefined();
	});

	it("returns projectAgentsDir when found", () => {
		writeProjectAgent("test", VALID_AGENT("test", "test"));
		const { projectAgentsDir } = discoverAgents(tempDir, "project");
		expect(projectAgentsDir).toBe(join(tempDir, ".openagent", "agents"));
	});

	it("returns null projectAgentsDir when not found", () => {
		const { projectAgentsDir } = discoverAgents(tempDir, "project");
		expect(projectAgentsDir).toBeNull();
	});
});

describe("formatAgentList", () => {
	it("returns 'none' for empty list", () => {
		expect(formatAgentList([], 10)).toEqual({ text: "none", remaining: 0 });
	});

	it("formats agent names with source and description", () => {
		const agents = [
			{
				name: "flagella",
				description: "Explorer",
				source: "builtin" as const,
				systemPrompt: "",
				filePath: "(builtin)",
			},
		];
		const result = formatAgentList(agents, 10);
		expect(result.text).toContain("flagella");
		expect(result.text).toContain("builtin");
		expect(result.text).toContain("Explorer");
		expect(result.remaining).toBe(0);
	});

	it("respects maxItems and reports remaining count", () => {
		const agents = Array.from({ length: 5 }, (_, i) => ({
			name: `agent-${i}`,
			description: `desc-${i}`,
			source: "project" as const,
			systemPrompt: "",
			filePath: `/tmp/agent-${i}.md`,
		}));
		const result = formatAgentList(agents, 3);
		expect(result.remaining).toBe(2);
	});
});
