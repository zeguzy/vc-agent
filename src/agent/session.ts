import {
	type AgentSession,
	type AgentSessionEvent,
	AuthStorage,
	createAgentSession,
	ModelRegistry,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { Config, ProviderConfig } from "../config.js";
import { SkillManager } from "../skills/manager.js";

export interface SessionOptions {
	cwd: string;
	model?: string;
	config?: Config;
}

export interface SessionResult {
	session: AgentSession;
	skillManager: SkillManager;
}

export async function createSession(options: SessionOptions): Promise<SessionResult> {
	const authStorage = AuthStorage.create();
	const modelRegistry = ModelRegistry.create(authStorage);

	if (options.config?.providers) {
		for (const [name, providerConfig] of Object.entries(options.config.providers)) {
			if (providerConfig.apiKey) {
				authStorage.setRuntimeApiKey(name, providerConfig.apiKey);
			}
			if (providerConfig.baseUrl || providerConfig.api || providerConfig.models) {
				registerCustomProvider(modelRegistry, name, providerConfig);
			}
		}
	}

	const modelStr = options.model ?? options.config?.model;
	const model = resolveModel(modelRegistry, modelStr);

	const settingsManager = SettingsManager.create(options.cwd);
	if (options.config?.thinking?.level) {
		settingsManager.setDefaultThinkingLevel(options.config.thinking.level as any);
	}

	// Initialize SkillManager with DefaultResourceLoader for skill discovery
	const skillManager = new SkillManager();
	const resourceLoader = await skillManager.initialize(options.cwd, options.config ?? {});

	const result = await createAgentSession({
		cwd: options.cwd,
		authStorage,
		modelRegistry,
		...(model ? { model } : {}),
		settingsManager,
		resourceLoader,
		tools: ["read", "bash", "edit", "write"],
		sessionManager: SessionManager.inMemory(),
	});
	return { session: result.session, skillManager };
}

function registerCustomProvider(registry: ModelRegistry, name: string, config: ProviderConfig) {
	registry.registerProvider(name, {
		...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
		...(config.api ? { api: config.api as any } : {}),
		...(config.headers ? { headers: config.headers } : {}),
		...(config.apiKey ? { apiKey: config.apiKey } : {}),
		...(config.models
			? {
					models: config.models.map((m) => ({
						id: m.id,
						name: m.name,
						api: (config.api ?? "openai") as any,
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

function resolveModel(registry: ModelRegistry, modelStr?: string) {
	if (!modelStr) return undefined;

	if (modelStr.includes(":")) {
		const [provider, modelId] = modelStr.split(":", 2);
		return registry.find(provider, modelId);
	}

	for (const m of registry.getAll()) {
		if (m.id === modelStr) return m;
	}
	return undefined;
}

export function extractAssistantContent(content: unknown): { text: string; thinking: string } {
	if (typeof content === "string") return { text: content, thinking: "" };
	if (!Array.isArray(content)) return { text: "", thinking: "" };
	let text = "";
	let thinking = "";
	for (const c of content as any[]) {
		if (c?.type === "text" && typeof c.text === "string") text += c.text;
		else if (c?.type === "thinking" && typeof c.thinking === "string") thinking += c.thinking;
	}
	return { text, thinking };
}

export function extractAssistantText(content: unknown): string {
	return extractAssistantContent(content).text;
}

export function summarizeArgs(args: unknown, maxLen = 50): string {
	const str = typeof args === "string" ? args : JSON.stringify(args);
	if (str.length <= maxLen) return str;
	return `${str.slice(0, maxLen - 3)}...`;
}

export type { AgentSession, AgentSessionEvent };
