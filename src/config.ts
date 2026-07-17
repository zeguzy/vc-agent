import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ContextPruningUserConfig } from "./dcp/config.js";
import { getDefaultNotificationsConfig } from "./notifications/config.js";
import type { NotificationsConfig } from "./notifications/types.js";
import type { TeamConfig } from "./teams/types.js";
import { DEFAULT_TEAM_CONFIG, resolveTeamConfig } from "./teams/types.js";
import { formatError } from "./utils/formatError.js";

export interface CustomModel {
	id: string;
	name: string;
	contextWindow?: number;
	maxTokens?: number;
	/** Whether the model supports reasoning/thinking. Default: false. */
	reasoning?: boolean;
	/** Custom mapping from Pi thinking levels to provider-specific values. */
	thinkingLevelMap?: Record<string, string>;
}

export type ModelTier = "fast" | "standard" | "powerful";

/**
 * Subagent model configuration. All model id strings should use colon syntax
 * (provider:model) for reliable resolveModel matching — bare strings risk
 * matching the wrong provider's model id.
 */
export interface SubagentsConfig {
	modelTiers?: Partial<Record<ModelTier, string>>;
	models?: Record<string, string>;
	fallback?: string;
}

export interface ProviderConfig {
	apiKey?: string;
	baseUrl?: string;
	api?: string;
	headers?: Record<string, string>;
	models?: CustomModel[];
}

export interface ThinkingConfig {
	level?: string;
	collapsed?: boolean;
}

export type DisplayConfig = {};

export interface CompactionConfig {
	enabled?: boolean;
	/** Tokens to reserve for the LLM response (Pi SDK default: 4096) */
	reserveTokens?: number;
	/** Approximate tokens to keep from recent messages (Pi SDK default: 8192) */
	keepRecentTokens?: number;
}

export interface SkillsConfig {
	/** Additional skill directories/files to scan beyond defaults */
	paths?: string[];
	/** Whether to auto-discover and inject skills at startup (default: true) */
	autoLoad?: boolean;
	/** Skill names to exclude from auto-loading */
	disabled?: string[];
}

export interface Config {
	model?: string;
	thinking?: ThinkingConfig;
	providers?: Record<string, ProviderConfig>;
	display?: DisplayConfig;
	compaction?: CompactionConfig;
	skills?: SkillsConfig;
	/** Native notification settings (OS notifications + TUI toasts). */
	notifications?: NotificationsConfig;
	/** teams 模式配置块——异步后台 worker pool。缺省时按 `DEFAULT_TEAM_CONFIG` 生效。 */
	teams?: TeamConfig;
	subagents?: SubagentsConfig;
	contextPruning?: ContextPruningUserConfig;
	/** Additional instruction files to inject into system prompt. Supports relative paths, ~/ expansion, globs, and HTTP(S) URLs. */
	instructions?: string[];
}

export function resolveConfigTeams(config: Config): ReturnType<typeof resolveTeamConfig> {
	const resolved = resolveTeamConfig(config.teams);
	if (resolved.isolation === "worktree") {
		console.error(
			'teams.isolation="worktree" not yet implemented, falling back to "none" (V1 reserved field)',
		);
	}
	return resolved;
}

function readJsonFile(filePath: string): Record<string, unknown> | null {
	if (!existsSync(filePath)) return null;
	try {
		const content = readFileSync(filePath, "utf-8");
		return JSON.parse(content);
	} catch (err) {
		console.error(`Warning: Failed to parse config at ${filePath}:`, formatError(err));
		return null;
	}
}

const ENV_REF = /^ENV\.([A-Z_][A-Z0-9_]*)$/;

export function resolveEnvVars<T>(value: T): T {
	if (typeof value === "string") {
		const match = value.match(ENV_REF);
		if (match) {
			const envValue = process.env[match[1]];
			if (envValue === undefined) {
				console.warn(`[config] ENV var "${match[1]}" not set`);
				return "" as unknown as T;
			}
			return envValue as unknown as T;
		}
		return value;
	}
	if (Array.isArray(value)) {
		return value.map((v) => resolveEnvVars(v)) as unknown as T;
	}
	if (value !== null && typeof value === "object") {
		const result: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
			result[k] = resolveEnvVars(v);
		}
		return result as unknown as T;
	}
	return value;
}

export function readConfig(cwd: string): Config {
	const globalPath = join(homedir(), ".config", "openagent", "config.json");
	const projectPath = join(cwd, ".openagent", "config.json");

	const globalRaw = readJsonFile(globalPath);
	const projectRaw = readJsonFile(projectPath);

	if (!globalRaw && !projectRaw) return {};
	if (!globalRaw) return resolveEnvVars(projectRaw as Config);
	if (!projectRaw) return resolveEnvVars(globalRaw as Config);

	return resolveEnvVars(deepMerge(globalRaw as Config, projectRaw as Config));
}

export function deepMerge<T>(global: T, project: Partial<T>): T {
	if (typeof global !== "object" || global === null) return (project ?? global) as T;
	if (typeof project !== "object" || project === null) return global;

	const result = (Array.isArray(global) ? [...global] : { ...global }) as Record<string, unknown>;
	for (const key of Object.keys(project as Record<string, unknown>)) {
		const gVal = (global as Record<string, unknown>)[key];
		const pVal = (project as Record<string, unknown>)[key];
		if (
			typeof gVal === "object" &&
			gVal !== null &&
			!Array.isArray(gVal) &&
			typeof pVal === "object" &&
			pVal !== null &&
			!Array.isArray(pVal)
		) {
			result[key] = deepMerge(gVal, pVal as Record<string, unknown>);
		} else if (pVal !== undefined) {
			result[key] = pVal;
		}
	}
	return result as T;
}

export function writeConfig(
	cwd: string,
	config: Config,
	scope: "project" | "global" = "project",
): void {
	const path =
		scope === "global"
			? join(homedir(), ".config", "openagent", "config.json")
			: join(cwd, ".openagent", "config.json");
	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
}

export function getDefaultConfigTemplate(): Config {
	return {
		thinking: { level: "medium", collapsed: false },
		compaction: { enabled: true, reserveTokens: 4096, keepRecentTokens: 8192 },
		skills: { paths: [], autoLoad: true, disabled: [] },
		instructions: [],
		providers: {},
		display: {},
		teams: { ...DEFAULT_TEAM_CONFIG },
		notifications: getDefaultNotificationsConfig(),
		contextPruning: { enabled: false },
	};
}
