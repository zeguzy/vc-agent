import { AuthStorage, ModelRegistry, SettingsManager } from "@earendil-works/pi-coding-agent";
import type { AgentConfig, SubagentServices } from "../../src/agents/types.js";
import type { ProviderConfig } from "../../src/config.js";

const XUNFEI_PROVIDER = "xunfei-astron";
const XUNFEI_MODEL_ID = "astron-code-latest";

function registerCustomProvider(
	registry: ModelRegistry,
	name: string,
	config: ProviderConfig,
): void {
	registry.registerProvider(name, {
		...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
		...(config.api ? { api: config.api as never } : {}),
		...(config.headers ? { headers: config.headers } : {}),
		...(config.apiKey ? { apiKey: config.apiKey } : {}),
		...(config.models
			? {
					models: config.models.map((m) => ({
						id: m.id,
						name: m.name,
						api: (config.api ?? "openai-completions") as never,
						...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
						reasoning: false,
						input: ["text" as const],
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
						contextWindow: m.contextWindow ?? 128000,
						maxTokens: m.maxTokens ?? 4096,
					})),
				}
			: {}),
	});
}

export function initXunfeiServices(apiKey: string): SubagentServices {
	const authStorage = AuthStorage.inMemory();
	const modelRegistry = ModelRegistry.inMemory(authStorage);
	authStorage.setRuntimeApiKey(XUNFEI_PROVIDER, apiKey);
	const settingsManager = SettingsManager.inMemory({});

	const config: ProviderConfig = {
		apiKey,
		baseUrl: "https://maas-coding-api.cn-huabei-1.xf-yun.com/v2",
		api: "openai-completions",
		models: [{ id: XUNFEI_MODEL_ID, name: "Astron Coding Plan", contextWindow: 128000 }],
	};
	registerCustomProvider(modelRegistry, XUNFEI_PROVIDER, config);

	return { authStorage, modelRegistry, settingsManager };
}

export function resolveXunfeiModel(services: SubagentServices) {
	return services.modelRegistry.find(XUNFEI_PROVIDER, XUNFEI_MODEL_ID);
}

/**
 * Builtin agent configs use "deepseek/deepseek-v4-pro" which resolves via
 * Pi SDK registry to an openrouter entry (needs openrouter key). Override
 * to undefined so runSubagent falls back to the parentModel we inject —
 * pre-existing, out of scope, tracked as follow-up.
 */
export function withResolvedModel(agent: AgentConfig): AgentConfig {
	return { ...agent, model: undefined };
}

export const BEHAVIOR_ENABLED = !!process.env.RUN_BEHAVIOR_TESTS;
export const XUNFEI_KEY = process.env.XUNFEI_ASTRON_KEY;
