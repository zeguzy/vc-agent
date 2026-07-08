import { describe, expect, it } from "bun:test";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import { BUILTIN_AGENTS } from "../src/agents/defaults.js";
import { buildNoModelError, resolveSubagentModel } from "../src/agents/model-resolver.js";
import type { AgentConfig } from "../src/agents/types.js";
import type { Config } from "../src/config.js";

interface MockModel {
	id: string;
	provider: string;
	name: string;
}

function makeRegistry(modelMap: Record<string, MockModel>): ModelRegistry {
	const all = Object.values(modelMap);
	return {
		find: (provider: string, modelId: string) => modelMap[`${provider}:${modelId}`] ?? undefined,
		getAll: () => all,
	} as unknown as ModelRegistry;
}

const FAST_MODEL: MockModel = { id: "Astron:fast", provider: "Astron", name: "Fast" };
const STANDARD_MODEL: MockModel = { id: "Astron:standard", provider: "Astron", name: "Standard" };
const POWERFUL_MODEL: MockModel = { id: "Astron:powerful", provider: "Astron", name: "Powerful" };
const GLOBAL_MODEL: MockModel = { id: "Astron:global", provider: "Astron", name: "Global" };
const FALLBACK_MODEL: MockModel = { id: "Astron:fallback", provider: "Astron", name: "Fallback" };
const AGENT_MODEL: MockModel = { id: "deepseek:ds-v4", provider: "deepseek", name: "DS-V4" };

const registry = makeRegistry({
	"Astron:fast": FAST_MODEL,
	"Astron:standard": STANDARD_MODEL,
	"Astron:powerful": POWERFUL_MODEL,
	"Astron:global": GLOBAL_MODEL,
	"Astron:fallback": FALLBACK_MODEL,
	"deepseek:ds-v4": AGENT_MODEL,
});

const baseAgent: AgentConfig = {
	name: "test-agent",
	description: "test",
	systemPrompt: "test",
	source: "builtin",
	filePath: "",
};

function opts(overrides: Partial<Parameters<typeof resolveSubagentModel>[0]> = {}) {
	return {
		agent: baseAgent,
		modelRegistry: registry,
		...overrides,
	};
}

describe("resolveSubagentModel chain priority", () => {
	it("① per-agent override wins over everything", () => {
		const agent: AgentConfig = { ...baseAgent, tier: "fast", model: "deepseek:ds-v4" };
		const config: Config = {
			subagents: {
				models: { "test-agent": "Astron:powerful" },
				modelTiers: { fast: "Astron:fast" },
				fallback: "Astron:fallback",
			},
			model: "Astron:global",
		};
		const result = resolveSubagentModel(opts({ agent, config, parentModel: STANDARD_MODEL }));
		expect(result).toBe(POWERFUL_MODEL);
	});

	it("② tier mapping wins when no per-agent override", () => {
		const agent: AgentConfig = { ...baseAgent, tier: "fast" };
		const config: Config = {
			subagents: {
				modelTiers: { fast: "Astron:fast" },
			},
		};
		const result = resolveSubagentModel(opts({ agent, config, parentModel: STANDARD_MODEL }));
		expect(result).toBe(FAST_MODEL);
	});

	it("③ parentModel wins over agent.model", () => {
		const agent: AgentConfig = { ...baseAgent, model: "deepseek:ds-v4" };
		const result = resolveSubagentModel(opts({ agent, parentModel: STANDARD_MODEL }));
		expect(result).toBe(STANDARD_MODEL);
	});

	it("④ agent.model used when no parentModel", () => {
		const agent: AgentConfig = { ...baseAgent, model: "deepseek:ds-v4" };
		const result = resolveSubagentModel(opts({ agent }));
		expect(result).toBe(AGENT_MODEL);
	});

	it("⑤ extraFallback used when no agent.model", () => {
		const agent: AgentConfig = { ...baseAgent };
		const result = resolveSubagentModel(opts({ agent, extraFallback: "Astron:fast" }));
		expect(result).toBe(FAST_MODEL);
	});

	it("⑥ config.subagents.fallback used when no extraFallback", () => {
		const agent: AgentConfig = { ...baseAgent };
		const config: Config = {
			subagents: { fallback: "Astron:fallback" },
		};
		const result = resolveSubagentModel(opts({ agent, config }));
		expect(result).toBe(FALLBACK_MODEL);
	});

	it("⑦ config.model (global) used as last resort", () => {
		const agent: AgentConfig = { ...baseAgent };
		const config: Config = { model: "Astron:global" };
		const result = resolveSubagentModel(opts({ agent, config }));
		expect(result).toBe(GLOBAL_MODEL);
	});

	it("returns undefined when all levels miss", () => {
		const agent: AgentConfig = { ...baseAgent };
		const result = resolveSubagentModel(opts({ agent }));
		expect(result).toBeUndefined();
	});

	it("skips tier when agent has no tier field", () => {
		const agent: AgentConfig = { ...baseAgent };
		const config: Config = {
			subagents: { modelTiers: { fast: "Astron:fast" } },
		};
		const result = resolveSubagentModel(opts({ agent, config }));
		expect(result).toBeUndefined();
	});

	it("skips unresolvable per-agent override, falls through to tier", () => {
		const agent: AgentConfig = { ...baseAgent, tier: "standard" };
		const config: Config = {
			subagents: {
				models: { "test-agent": "NonExistent:model" },
				modelTiers: { standard: "Astron:standard" },
			},
		};
		const result = resolveSubagentModel(opts({ agent, config }));
		expect(result).toBe(STANDARD_MODEL);
	});

	it("skips unresolvable tier, falls through to parentModel", () => {
		const agent: AgentConfig = { ...baseAgent, tier: "fast" };
		const config: Config = {
			subagents: { modelTiers: { fast: "NonExistent:model" } },
		};
		const result = resolveSubagentModel(opts({ agent, config, parentModel: POWERFUL_MODEL }));
		expect(result).toBe(POWERFUL_MODEL);
	});
});

describe("buildNoModelError", () => {
	it("includes agent name and diagnostic info", () => {
		const agent: AgentConfig = {
			...baseAgent,
			tier: "fast",
			model: "deepseek:ds-v4",
		};
		const msg = buildNoModelError(agent);
		expect(msg).toContain("test-agent");
		expect(msg).toContain("tier=fast");
		expect(msg).toContain("deepseek:ds-v4");
	});

	it("shows 'none' for missing tier and model", () => {
		const msg = buildNoModelError(baseAgent);
		expect(msg).toContain("tier=none");
		expect(msg).toContain("agent.model=none");
	});
});

describe("builtin agent tier assignments", () => {
	const expectedTiers: Record<string, string> = {
		flagella: "fast",
		ribosome: "standard",
		nucleus: "powerful",
		plasmid: "standard",
		lysosome: "powerful",
	};

	for (const [name, tier] of Object.entries(expectedTiers)) {
		it(`${name} has tier="${tier}"`, () => {
			const agent = BUILTIN_AGENTS.find((a) => a.name === name);
			expect(agent).toBeDefined();
			expect(agent?.tier).toBe(tier);
		});
	}

	it("all 5 builtin agents have a tier assigned", () => {
		for (const agent of BUILTIN_AGENTS) {
			expect(agent.tier).toBeDefined();
			expect(["fast", "standard", "powerful"]).toContain(agent.tier);
		}
	});
});
