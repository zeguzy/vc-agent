import type { AuthStorage, ModelRegistry, SettingsManager } from "@earendil-works/pi-coding-agent";
import type { Config, ModelTier } from "../config.js";

export type AgentScope = "user" | "project" | "both";
export type AgentSource = "builtin" | "user" | "project";

export interface AgentConfig {
	name: string;
	description: string;
	tools?: string[];
	model?: string;
	systemPrompt: string;
	source: AgentSource;
	filePath: string;
	disallowedTools?: string[];
	maxTurns?: number;
	background?: boolean;
	permissionMode?: AgentPermissionMode;
	tier?: ModelTier;
}

export type AgentPermissionMode = "default" | "plan" | "acceptEdits";

export interface AgentDiscoveryResult {
	agents: AgentConfig[];
	projectAgentsDir: string | null;
}

export interface SubagentTask {
	agent: string;
	description: string;
}

export interface SubagentUsage {
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	cost: number;
	turns: number;
}

export interface SubagentResult {
	agent: string;
	description: string;
	output: string;
	usage?: SubagentUsage;
	error?: string;
	/** Session ID for continuation (ses_xxx format) */
	sessionId?: string;
	/** Task category (quick/deep/ultrabrain/visual-engineering/etc.) */
	category?: string;
	/** Background task ID (bg_xxx format), set when run_in_background=true */
	backgroundTaskId?: string;
}

/**
 * Three execution modes:
 * - single: one agent, one task
 * - parallel: multiple tasks concurrently (max 8, 4 at a time)
 * - chain: sequential tasks, `{previous}` in description is replaced with prior output
 */
export type SubagentToolParams =
	| {
			mode: "single";
			agent: string;
			description: string;
			prompt?: string;
			category?: string;
			subagent_type?: string;
			run_in_background?: boolean;
			task_id?: string;
			command?: string;
			load_skills?: string[];
	  }
	| { mode: "parallel"; tasks: SubagentTask[] }
	| { mode: "chain"; tasks: SubagentTask[] };

export interface SubagentToolDetails {
	mode: "single" | "parallel" | "chain";
	results: SubagentResult[];
	totalCost: number;
	totalTurns: number;
}

export interface SubagentServices {
	authStorage: AuthStorage;
	modelRegistry: ModelRegistry;
	settingsManager: SettingsManager;
	config?: Config;
}

export interface RunSubagentOptions {
	agent: AgentConfig;
	task: string;
	cwd: string;
	services: SubagentServices;
	parentModel?: ReturnType<ModelRegistry["getAll"]>[number];
	signal?: AbortSignal;
	onUpdate?: (text: string) => void;
	category?: string;
	loadSkills?: string[];
	runInBackground?: boolean;
	parentSessionId?: string;
	taskRegistry?: import("./task-registry.js").TaskRegistry;
	onBackgroundComplete?: (taskId: string, result: SubagentResult) => void;
}

export interface ContinueSubagentOptions {
	sessionId: string;
	task: string;
	taskRegistry: import("./task-registry.js").TaskRegistry;
	onUpdate?: (text: string) => void;
}

export const MAX_PARALLEL_TASKS = 8;
export const PARALLEL_CONCURRENCY = 4;
export const MAX_OUTPUT_CHARS = 50_000;
