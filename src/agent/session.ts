import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	type AgentSession,
	type AgentSessionEvent,
	type AgentSessionRuntime,
	type AgentSessionServices,
	AuthStorage,
	type CreateAgentSessionRuntimeFactory,
	createAgentSession,
	createAgentSessionRuntime,
	ModelRegistry,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { Config, ProviderConfig } from "../config.js";
import { createLspToolDefinitions, LspClient } from "../lsp/index.js";
import { listSessions, resolveSessionRef } from "../session/list.js";
import { resolveSessionDir } from "../session/storage.js";
import { SkillManager } from "../skills/manager.js";
import { createTodoTool } from "../tools/todo.js";

const BUILTIN_TOOLS = ["read", "bash", "edit", "write", "grep", "find"];
const LSP_TOOL_NAMES = ["lsp_diagnostics", "lsp_goto_definition", "lsp_find_references"];
const ALL_TOOLS = [...BUILTIN_TOOLS, ...LSP_TOOL_NAMES];

/** Tools available in planner mode — read-only, no file mutations. */
const PLANNER_TOOLS = ["read", "bash", "grep", "find", ...LSP_TOOL_NAMES];

/**
 * Active tool sets per agent mode. Used both for initial activation and for
 * setActiveToolsByName() on mode toggle. Always includes the `todo` tool so
 * task tracking survives mode switches.
 */
export const STANDARD_ACTIVE_TOOLS = [...ALL_TOOLS, "todo"];
export const PLANNER_ACTIVE_TOOLS = [...PLANNER_TOOLS, "todo"];

export function activeToolsFor(agentMode: AgentMode): string[] {
	return agentMode === "planner" ? PLANNER_ACTIVE_TOOLS : STANDARD_ACTIVE_TOOLS;
}

/** Agent runtime mode — controls tool availability and system prompt. */
export type AgentMode = "standard" | "planner";

/**
 * How the initial SessionManager should be constructed at startup.
 *
 * `-r/--resume` is handled at the CLI layer (mode `new` + a flag that opens
 * the list after TUI mount), so it has no entry here.
 */
export type SessionMode = "new" | "continue" | "session";

export interface SessionOptions {
	cwd: string;
	model?: string;
	config?: Config;
}

export interface SessionResult {
	session: AgentSession;
	skillManager: SkillManager;
}

export interface RuntimeOptions {
	cwd: string;
	/** LLM model id (overrides config.model) */
	model?: string;
	config?: Config;
	/** SessionManager construction mode. Defaults to "new". */
	mode?: SessionMode;
	/** `<path|id>` reference for mode "session". */
	sessionRef?: string;
	/** Optional display name applied via setSessionName after runtime creation. */
	name?: string;
	/** Agent runtime mode. "planner" starts with edit/write tools disabled. */
	agentMode?: AgentMode;
}

export interface RuntimeResult {
	runtime: AgentSessionRuntime;
	skillManager: SkillManager;
}

/**
 * Initialized cwd-bound services shared across session replacements.
 *
 * openagent runs with a single fixed cwd/config per process, so these are
 * created once and reused by the runtime factory on every switchSession /
 * newSession (the SDK factory contract allows this; only the SessionManager
 * differs across switches).
 */
interface InitializedServices {
	authStorage: AuthStorage;
	modelRegistry: ModelRegistry;
	settingsManager: SettingsManager;
	skillManager: SkillManager;
	lspClient: LspClient;
	resourceLoader: Awaited<ReturnType<SkillManager["initialize"]>>;
	model: ReturnType<typeof resolveModel>;
}

async function initServices(opts: {
	cwd: string;
	config?: Config;
	modelStr?: string;
}): Promise<InitializedServices> {
	const authStorage = AuthStorage.inMemory();
	const modelRegistry = ModelRegistry.inMemory(authStorage);

	if (opts.config?.providers) {
		for (const [name, providerConfig] of Object.entries(opts.config.providers)) {
			if (providerConfig.apiKey) {
				authStorage.setRuntimeApiKey(name, providerConfig.apiKey);
			}
			if (providerConfig.baseUrl || providerConfig.api || providerConfig.models) {
				registerCustomProvider(modelRegistry, name, providerConfig);
			}
		}
	}

	const model = resolveModel(modelRegistry, opts.modelStr);
	const settingsManager = SettingsManager.inMemory(convertConfigToSettings(opts.config));

	const skillManager = new SkillManager();
	const resourceLoader = await skillManager.initialize(
		opts.cwd,
		opts.config ?? {},
		settingsManager,
	);

	const lspClient = new LspClient(opts.cwd);
	const lspReady = await lspClient.init();
	if (!lspReady) {
		console.warn(
			"LSP: typescript-language-server not available.",
			lspClient.getInitError(),
			"LSP tools will report errors when called.",
		);
	}

	return {
		authStorage,
		modelRegistry,
		settingsManager,
		skillManager,
		lspClient,
		resourceLoader,
		model,
	};
}

/**
 * Legacy entry: creates an in-memory (non-persistent) session.
 *
 * Kept for backwards compatibility; the runtime path (`createRuntime`) is the
 * default since session-management.
 */
export async function createSession(options: SessionOptions): Promise<SessionResult> {
	const svc = await initServices({
		cwd: options.cwd,
		config: options.config,
		modelStr: options.model ?? options.config?.model,
	});
	const result = await createAgentSession({
		cwd: options.cwd,
		authStorage: svc.authStorage,
		modelRegistry: svc.modelRegistry,
		...(svc.model ? { model: svc.model } : {}),
		settingsManager: svc.settingsManager,
		resourceLoader: svc.resourceLoader,
		tools: STANDARD_ACTIVE_TOOLS,
		customTools: [...createLspToolDefinitions({ client: svc.lspClient }), createTodoTool()],
		sessionManager: SessionManager.inMemory(),
	});
	return { session: result.session, skillManager: svc.skillManager };
}

/**
 * Create an AgentSessionRuntime bound to a persisted SessionManager.
 *
 * The runtime owns the current session and exposes `switchSession` /
 * `newSession` for in-TUI hot-switching. App holds `runtime` (not `session`)
 * and reads `runtime.session` for the current session.
 */
export async function createRuntime(options: RuntimeOptions): Promise<RuntimeResult> {
	const cwd = options.cwd;
	const sessionDir = resolveSessionDir();
	const sessionManager = await buildSessionManager(options, sessionDir);
	const agentDir = join(homedir(), ".config", "openagent");
	const agentMode = options.agentMode ?? "standard";

	const svc = await initServices({
		cwd,
		config: options.config,
		modelStr: options.model ?? options.config?.model,
	});

	const factory: CreateAgentSessionRuntimeFactory = async ({
		cwd: fCwd,
		agentDir: fAgentDir,
		sessionManager: fSessionManager,
	}) => {
		const result = await createAgentSession({
			cwd: fCwd,
			authStorage: svc.authStorage,
			modelRegistry: svc.modelRegistry,
			...(svc.model ? { model: svc.model } : {}),
			settingsManager: svc.settingsManager,
			resourceLoader: svc.resourceLoader,
			tools: activeToolsFor(agentMode),
			customTools: [...createLspToolDefinitions({ client: svc.lspClient }), createTodoTool()],
			sessionManager: fSessionManager,
		});
		const services: AgentSessionServices = {
			cwd: fCwd,
			agentDir: fAgentDir,
			authStorage: svc.authStorage,
			settingsManager: svc.settingsManager,
			modelRegistry: svc.modelRegistry,
			resourceLoader: svc.resourceLoader,
			diagnostics: [],
		};
		return { ...result, services, diagnostics: [] };
	};

	const runtime = await createAgentSessionRuntime(factory, { cwd, agentDir, sessionManager });

	if (options.name) {
		runtime.session.setSessionName(options.name);
	}

	return { runtime, skillManager: svc.skillManager };
}

async function buildSessionManager(
	options: RuntimeOptions,
	sessionDir: string,
): Promise<SessionManager> {
	const cwd = options.cwd;
	const mode = options.mode ?? "new";
	switch (mode) {
		case "new":
			return SessionManager.create(cwd, sessionDir);
		case "continue":
			return SessionManager.continueRecent(cwd, sessionDir);
		case "session": {
			const ref = options.sessionRef?.trim();
			if (!ref) throw new Error("--session 需要指定 <path|id>");
			if (existsSync(ref)) return SessionManager.open(ref, sessionDir);
			const sessions = await listSessions(cwd, sessionDir);
			const path = resolveSessionRef(sessions, ref);
			if (!path) throw new Error(`未找到会话: ${ref}`);
			return SessionManager.open(path, sessionDir);
		}
	}
}

function convertConfigToSettings(config?: Config): Record<string, unknown> {
	const settings: Record<string, unknown> = {};
	if (config?.thinking?.level) {
		settings.defaultThinkingLevel = config.thinking.level;
	}
	if (config?.compaction) {
		settings.compaction = {
			enabled: config.compaction.enabled,
			reserveTokens: config.compaction.reserveTokens,
			keepRecentTokens: config.compaction.keepRecentTokens,
		};
	}
	return settings;
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

// Re-export content utilities for backward compatibility
export { extractAssistantContent, extractAssistantText, summarizeArgs } from "../utils/content.js";

export type { AgentSession, AgentSessionEvent, AgentSessionRuntime };
