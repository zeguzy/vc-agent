import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { NotificationsConfig } from "./notifications/types.js";
import { formatError } from "./utils/formatError.js";

export interface CustomModel {
	id: string;
	name: string;
	contextWindow?: number;
	maxTokens?: number;
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
	/** Additional instruction files to inject into system prompt. Supports relative paths, ~/ expansion, globs, and HTTP(S) URLs. */
	instructions?: string[];
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

export function readConfig(cwd: string): Config {
	const globalPath = join(homedir(), ".config", "openagent", "config.json");
	const projectPath = join(cwd, ".openagent", "config.json");

	const globalRaw = readJsonFile(globalPath);
	const projectRaw = readJsonFile(projectPath);

	if (!globalRaw && !projectRaw) return {};
	if (!globalRaw) return projectRaw as Config;
	if (!projectRaw) return globalRaw as Config;

	return deepMerge(globalRaw as Config, projectRaw as Config);
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
