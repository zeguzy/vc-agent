import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { formatError } from "../utils/formatError.js";
import type { McpJsonConfig } from "./types.js";

/**
 * Read and merge MCP server configurations.
 * Global: ~/.config/openagent/mcp.json
 * Project: <cwd>/.openagent/mcp.json
 * Project entries override global entries with the same server name.
 */
export function readMcpConfig(cwd: string): McpJsonConfig {
	const globalPath = join(homedir(), ".config", "openagent", "mcp.json");
	const projectPath = join(cwd, ".openagent", "mcp.json");

	const globalConfig = readMcpJsonFile(globalPath);
	const projectConfig = readMcpJsonFile(projectPath);

	if (!globalConfig && !projectConfig) return {};
	if (!globalConfig) return projectConfig;
	if (!projectConfig) return globalConfig;

	// Merge: project overrides global for same server names
	return { ...globalConfig, ...projectConfig };
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
