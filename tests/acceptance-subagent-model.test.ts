import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BUILTIN_AGENTS } from "../src/agents/defaults.js";
import { buildNoModelError, resolveSubagentModel } from "../src/agents/model-resolver.js";
import type { AgentConfig } from "../src/agents/types.js";
import type { Config } from "../src/config.js";

const runnerSrc = readFileSync(join(import.meta.dirname, "../src/agents/runner.ts"), "utf-8");
const workerSrc = readFileSync(join(import.meta.dirname, "../src/teams/worker.ts"), "utf-8");
const configSrc = readFileSync(join(import.meta.dirname, "../src/config.ts"), "utf-8");

describe("acceptance: subagent-model-tier-config — bug fix", () => {
	it("runner.ts no longer calls resolveModel directly", () => {
		expect(runnerSrc).not.toContain("resolveModel(");
		expect(runnerSrc).toContain("resolveSubagentModel");
	});

	it("worker.ts uses unified resolveSubagentModel", () => {
		expect(workerSrc).toContain("resolveSubagentModel");
		expect(workerSrc).not.toMatch(/const\s+model\s*=\s*agent\.model\s*\?/);
	});

	it("runner.ts throws buildNoModelError when model unresolved", () => {
		expect(runnerSrc).toContain("buildNoModelError");
	});

	it("worker.ts passes extraFallback (defaultWorkerModel) to resolver", () => {
		expect(workerSrc).toContain("extraFallback");
	});
});

describe("acceptance: subagent-model-tier-config — config schema", () => {
	it("config.ts exports SubagentsConfig", () => {
		expect(configSrc).toContain("SubagentsConfig");
		expect(configSrc).toContain("modelTiers");
		expect(configSrc).toContain("ModelTier");
	});

	it("Config interface has subagents field", () => {
		expect(configSrc).toMatch(/subagents\?\s*:\s*SubagentsConfig/);
	});
});

describe("acceptance: subagent-model-tier-config — tier assignment", () => {
	it("all builtin agents have tier field", () => {
		for (const agent of BUILTIN_AGENTS) {
			expect(agent.tier).toBeDefined();
		}
	});

	it("tier values are valid enum members", () => {
		const validTiers = ["fast", "standard", "powerful"];
		for (const agent of BUILTIN_AGENTS) {
			expect(validTiers).toContain(agent.tier);
		}
	});
});

describe("acceptance: subagent-model-tier-config — the actual bug scenario", () => {
	it("parentModel resolves to Astron, not openrouter, when agent.model is 'deepseek/...'", () => {
		const astronModel = {
			id: "Astron:astron-code-latest",
			provider: "Astron",
			name: "Astron Code",
		};
		const openrouterModel = {
			id: "deepseek/deepseek-v4-pro",
			provider: "openrouter",
			name: "DS V4 (OpenRouter)",
		};

		const mockRegistry = {
			find: (p: string, m: string) =>
				p === "Astron" && m === "astron-code-latest" ? astronModel : undefined,
			getAll: () => [astronModel, openrouterModel],
		} as never;

		const flagella = BUILTIN_AGENTS.find((a) => a.name === "flagella")!;

		const result = resolveSubagentModel({
			agent: flagella,
			modelRegistry: mockRegistry,
			parentModel: astronModel,
		});

		expect(result).toBe(astronModel);
		expect(result?.provider).toBe("Astron");
		expect(result?.provider).not.toBe("openrouter");
	});

	it("tier mapping resolves when parentModel is absent", () => {
		const fastModel = { id: "Astron:mini", provider: "Astron", name: "Mini" };
		const mockRegistry = {
			find: (_p: string, m: string) => (m === "mini" ? fastModel : undefined),
			getAll: () => [fastModel],
		} as never;

		const config: Config = {
			subagents: { modelTiers: { fast: "Astron:mini" } },
		};

		const flagella = BUILTIN_AGENTS.find((a) => a.name === "flagella")!;

		const result = resolveSubagentModel({
			agent: flagella,
			config,
			modelRegistry: mockRegistry,
		});

		expect(result).toBe(fastModel);
	});

	it("buildNoModelError includes actionable diagnostics", () => {
		const agent: AgentConfig = {
			name: "test",
			description: "",
			systemPrompt: "",
			source: "builtin",
			filePath: "",
			tier: "fast",
			model: "deepseek/deepseek-v4-pro",
		};
		const msg = buildNoModelError(agent);
		expect(msg).toContain("test");
		expect(msg).toContain("tier=fast");
		expect(msg).toContain("deepseek/deepseek-v4-pro");
	});
});
