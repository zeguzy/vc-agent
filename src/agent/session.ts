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
import {
	buildAvailableAgentsPrompt,
	buildAvailableSkillsPrompt,
	discoverAgents,
} from "../agents/discover.js";
import type { Config, ProviderConfig } from "../config.js";
import { ORCHESTRATOR_SYSTEM_PROMPT, TEAM_ORCHESTRATOR_PROMPT } from "../context-files.js";
import { activateDcpExtension, prepareDcpExtension } from "../dcp/init.js";
import type { DiffReviewManager } from "../diff-review/manager.js";
import { createLspToolDefinitions, LspClient } from "../lsp/index.js";
import { McpManager } from "../mcp/manager.js";
import { installSqliteBackend } from "../session/install-sqlite-backend.js";
import { listSessions, resolveSessionRef } from "../session/list.js";
import { resolveSessionDir } from "../session/storage.js";
import { SkillManager } from "../skills/manager.js";
import type { TeamManagerRef } from "../teams/types-v2.js";
import { createEditTool } from "../tools/edit.js";
import { clearEditConfirmBridge, type EditConfirmBridge } from "../tools/edit-confirm-bridge.js";
import { createGlobToolDefinition } from "../tools/glob.js";
import { createMemoryTool } from "../tools/memory.js";
import { createMessageTool } from "../tools/message.js";
import { createNotifyTool } from "../tools/notify.js";
import { createQuestionTool } from "../tools/question.js";
import { clearBridge, type QuestionBridge } from "../tools/question-bridge.js";
import { createSubagentTool } from "../tools/subagent.js";
import { createTeamTool } from "../tools/team.js";
import { createTeamGuardedBashTool, createTeamGuardedWriteTool } from "../tools/team-guard.js";
import { createTodoTool } from "../tools/todo.js";
import { createWebfetchTool } from "../tools/webfetch/index.js";

export const BUILTIN_TOOLS = ["read", "bash", "write", "grep", "find"];
const LSP_TOOL_NAMES = ["lsp"];
const ALL_TOOLS = [...BUILTIN_TOOLS, ...LSP_TOOL_NAMES];

/** Tools available in planner mode — read-only, no file mutations. */
const PLANNER_TOOLS = ["read", "bash", "grep", "find", ...LSP_TOOL_NAMES];

/**
 * Active tool sets per agent mode. Used both for initial activation and for
 * setActiveToolsByName() on mode toggle. Always includes the `todo` tool so
 * task tracking survives mode switches.
 */
export const STANDARD_ACTIVE_TOOLS = [
	...ALL_TOOLS,
	"glob",
	"edit",
	"todo",
	"question",
	"subagent",
	"webfetch",
];
export const PLANNER_ACTIVE_TOOLS = [...PLANNER_TOOLS, "glob", "todo", "question", "webfetch"];
export const TEAM_ACTIVE_TOOLS = [
	...ALL_TOOLS,
	"glob",
	"edit",
	"todo",
	"question",
	"webfetch",
	"team",
	"memory",
	"message",
	"subagent",
];

export function activeToolsFor(agentMode: AgentMode): string[] {
	if (agentMode === "planner") return PLANNER_ACTIVE_TOOLS;
	if (agentMode === "team") return TEAM_ACTIVE_TOOLS;
	return STANDARD_ACTIVE_TOOLS;
}

/** Agent runtime mode — controls tool availability and system prompt. */
export type AgentMode = "standard" | "planner" | "orchestrator" | "team";

export function getBaseMode(config?: Config): AgentMode {
	return config?.teams?.enabled !== false ? "team" : "standard";
}

/**
 * Build the cycle map for Tab key / /plan agent mode switching.
 *
 * The cycle maps each mode to the next in a circular list. When
 * `config.teams.agentModes` is set, it uses the user-defined order;
 * otherwise the default depends on `teams.enabled`:
 *   enabled=false → standard → planner → orchestrator → standard
 *   enabled=true  → standard → team → planner → orchestrator → standard
 */
export function buildAgentModeCycle(config?: Config): Record<string, AgentMode> {
	const userModes = config?.teams?.agentModes;
	const modes: AgentMode[] =
		userModes && userModes.length > 0
			? userModes
			: config?.teams?.enabled !== false
				? ["standard", "team", "planner", "orchestrator"]
				: ["standard", "planner", "orchestrator"];
	const cycle: Record<string, AgentMode> = {};
	for (let i = 0; i < modes.length; i++) {
		cycle[modes[i]] = modes[(i + 1) % modes.length];
	}
	return cycle;
}

// CACHE-STATIC: appended prompts (ORCHESTRATOR/TEAM/agent list) are stable
// across turns. Runtime task injections go through session.steer(), which is
// CACHE-DYNAMIC and must be appended after these static segments.
export function appendSystemPromptFor(
	agentMode: AgentMode,
	config?: Config,
	cwd?: string,
): string[] | undefined {
	const injectAgentList = (prompts: string[]): string[] => {
		if (!cwd) return prompts;
		if (agentMode !== "standard" && agentMode !== "orchestrator" && agentMode !== "team")
			return prompts;
		const { agents } = discoverAgents(cwd);
		const agentList = buildAvailableAgentsPrompt(agents);
		let result = agentList ? [...prompts, agentList] : prompts;
		// Inject skill list for team mode only
		if (agentMode === "team") {
			const skillList = buildAvailableSkillsPrompt(cwd);
			if (skillList) result = [...result, skillList];
		}
		return result;
	};

	if (agentMode === "team") return injectAgentList([TEAM_ORCHESTRATOR_PROMPT]);
	if (agentMode === "orchestrator") {
		const prompts = [ORCHESTRATOR_SYSTEM_PROMPT];
		if (config?.teams?.enabled !== false) prompts.push(TEAM_ORCHESTRATOR_PROMPT);
		return injectAgentList(prompts);
	}
	if (agentMode === "standard") {
		const injected = injectAgentList([]);
		return injected.length ? injected : undefined;
	}
	return undefined;
}

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
	bridge?: QuestionBridge;
	editBridge?: EditConfirmBridge;
	reviewManager?: DiffReviewManager;
	teamRef?: TeamManagerRef;
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
	/** QuestionBridge for interactive question tool. Omit in non-interactive modes. */
	bridge?: QuestionBridge;
	editBridge?: EditConfirmBridge;
	reviewManager?: DiffReviewManager;
	teamRef?: TeamManagerRef;
}

export interface RuntimeResult {
	runtime: AgentSessionRuntime;
	skillManager: SkillManager;
	mcpManager: McpManager;
}

/**
 * Initialized cwd-bound services shared across session replacements.
 *
 * openagent runs with a single fixed cwd/config per process, so these are
 * created once and reused by the runtime factory on every switchSession /
 * newSession (the SDK factory contract allows this; only the SessionManager
 * differs across switches).
 */
export interface InitializedServices {
	authStorage: AuthStorage;
	modelRegistry: ModelRegistry;
	settingsManager: SettingsManager;
	skillManager: SkillManager;
	lspClient: LspClient;
	resourceLoader: Awaited<ReturnType<SkillManager["initialize"]>>;
	model: ReturnType<typeof resolveModel>;
	mcpManager: McpManager;
	config?: Config;
}

async function initServices(opts: {
	cwd: string;
	config?: Config;
	modelStr?: string;
	appendSystemPrompt?: string[];
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
	const lspClient = new LspClient(opts.cwd);
	const mcpManager = new McpManager();

	// Parallel init: Skill/LSP/MCP have no data dependencies
	const [resourceLoader, lspReady] = await Promise.all([
		skillManager.initialize(opts.cwd, opts.config ?? {}, settingsManager, opts.appendSystemPrompt),
		lspClient.init(),
		mcpManager.initialize(opts.cwd),
	]);

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
		mcpManager,
		config: opts.config,
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
	const teamTools =
		options.teamRef && options.config?.teams?.enabled !== false
			? buildTeamTools(options.teamRef)
			: [];

	const mcpToolDefs = svc.mcpManager.getToolDefinitions();
	const dcpTool = prepareDcpExtension(options.config?.contextPruning);
	const result = await createAgentSession({
		cwd: options.cwd,
		authStorage: svc.authStorage,
		modelRegistry: svc.modelRegistry,
		...(svc.model ? { model: svc.model } : {}),
		settingsManager: svc.settingsManager,
		resourceLoader: svc.resourceLoader,
		tools: [
			...STANDARD_ACTIVE_TOOLS,
			...(mcpToolDefs.length ? ["mcp"] : []),
			...(dcpTool ? ["compress"] : []),
		],
		customTools: [
			...createLspToolDefinitions({ client: svc.lspClient }),
			createTodoTool(),
			createEditTool(options.cwd, {
				bridge: options.editBridge,
				reviewManager: options.reviewManager,
			}),
			createQuestionTool(options.bridge),
			createNotifyTool(),
			createWebfetchTool(),
			createGlobToolDefinition(options.cwd),
			createSubagentTool({
				cwd: options.cwd,
				services: svc,
				parentModel: svc.model,
			}),
			...teamTools,
			...mcpToolDefs,
			...(dcpTool ? [dcpTool] : []),
		],
		sessionManager: SessionManager.inMemory(),
	});
	if (dcpTool) {
		activateDcpExtension(result.session);
	}
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
	await installSqliteBackend();
	const sessionDir = resolveSessionDir();
	const sessionManager = await buildSessionManager(options, sessionDir);
	const agentDir = join(homedir(), ".config", "openagent");
	const agentMode =
		options.agentMode ?? (options.config?.teams?.enabled !== false ? "team" : "standard");

	const svc = await initServices({
		cwd,
		config: options.config,
		modelStr: options.model ?? options.config?.model,
		appendSystemPrompt: appendSystemPromptFor(agentMode, options.config, cwd),
	});

	const factory: CreateAgentSessionRuntimeFactory = async ({
		cwd: fCwd,
		agentDir: fAgentDir,
		sessionManager: fSessionManager,
	}) => {
		if (options.bridge) clearBridge(options.bridge);
		if (options.editBridge) clearEditConfirmBridge(options.editBridge);
		const isTeamMode = agentMode === "team";
		const teamTools =
			isTeamMode && options.teamRef && options.config?.teams?.enabled !== false
				? buildTeamTools(options.teamRef)
				: [];
		const customTools: import("@earendil-works/pi-coding-agent").ToolDefinition[] = [
			...createLspToolDefinitions({ client: svc.lspClient }),
			createTodoTool(),
			createEditTool(fCwd, { bridge: options.editBridge, reviewManager: options.reviewManager }),
			createQuestionTool(options.bridge),
			createNotifyTool(),
			createWebfetchTool(),
			createGlobToolDefinition(fCwd),
		];
		if (isTeamMode) {
			customTools.push(createTeamGuardedBashTool(fCwd), createTeamGuardedWriteTool(fCwd));
		}
		customTools.push(
			createSubagentTool({
				cwd: fCwd,
				services: svc,
				parentModel: svc.model,
			}),
		);
		customTools.push(...teamTools);
		const dcpTool = prepareDcpExtension(options.config?.contextPruning);
		if (dcpTool) {
			customTools.push(dcpTool);
		}
		const mcpToolDefs = svc.mcpManager.getToolDefinitions();
		const result = await createAgentSession({
			cwd: fCwd,
			authStorage: svc.authStorage,
			modelRegistry: svc.modelRegistry,
			...(svc.model ? { model: svc.model } : {}),
			settingsManager: svc.settingsManager,
			resourceLoader: svc.resourceLoader,
			tools: [
				...activeToolsFor(agentMode),
				...(mcpToolDefs.length ? ["mcp"] : []),
				...(dcpTool ? ["compress"] : []),
			],
			customTools: [...customTools, ...mcpToolDefs],
			sessionManager: fSessionManager,
		});
		if (dcpTool) {
			activateDcpExtension(result.session);
		}
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

	return { runtime, skillManager: svc.skillManager, mcpManager: svc.mcpManager };
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

export function resolveModel(registry: ModelRegistry, modelStr?: string) {
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

function buildTeamTools(
	teamRef: import("../teams/types-v2.js").TeamManagerRef,
): import("@earendil-works/pi-coding-agent").ToolDefinition[] {
	return [
		createTeamTool({ teamRef }),
		createMemoryTool({ teamRef }),
		createMessageTool({ teamRef }),
	];
}
