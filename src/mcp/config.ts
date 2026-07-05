import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { formatError } from "../utils/formatError.js";
import type { McpJsonConfig, McpLocalServerConfig, McpRemoteServerConfig } from "./types.js";

export function readMcpConfig(cwd: string): McpJsonConfig {
	const globalPath = join(homedir(), ".config", "openagent", "mcp.json");
	const projectPath = join(cwd, ".openagent", "mcp.json");

	const globalConfig = readMcpJsonFile(globalPath);
	const projectConfig = readMcpJsonFile(projectPath);

	if (!globalConfig && !projectConfig) return {};
	if (!globalConfig) return resolveEnvRefs(projectConfig);
	if (!projectConfig) return resolveEnvRefs(globalConfig);

	return resolveEnvRefs({ ...globalConfig, ...projectConfig });
}

function readMcpJsonFile(filePath: string): McpJsonConfig {
	if (!existsSync(filePath)) return {};
	try {
		const content = readFileSync(filePath, "utf-8");
		return JSON.parse(content) as McpJsonConfig;
	} catch (err) {
		console.error(`Warning: Failed to parse MCP config at ${filePath}:`, formatError(err));
		return {};
	}
}

function resolveEnvRefs(config: McpJsonConfig): McpJsonConfig {
	const resolved: McpJsonConfig = {};
	for (const [name, entry] of Object.entries(config)) {
		if (entry.type === "remote" && entry.headers) {
			resolved[name] = {
				...entry,
				headers: resolveEnvMap(entry.headers, name, "header"),
			} as McpRemoteServerConfig;
		} else if (entry.type === "local" && entry.env) {
			resolved[name] = {
				...entry,
				env: resolveEnvMap(entry.env, name, "env"),
			} as McpLocalServerConfig;
		} else {
			resolved[name] = entry;
		}
	}
	return resolved;
}

function resolveEnvMap(
	map: Record<string, string>,
	serverName: string,
	kind: string,
): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(map)) {
		if (value.startsWith("env:")) {
			const envVar = value.slice(4);
			const envValue = process.env[envVar];
			if (envValue) {
				out[key] = envValue;
			} else {
				console.error(
					`[mcp] Warning: env var "${envVar}" not set for server "${serverName}" ${kind} "${key}"`,
				);
			}
		} else {
			out[key] = value;
		}
	}
	return out;
}
