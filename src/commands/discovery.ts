import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, extname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { type Command, commandRegistry } from "./registry.js";

const GLOBAL_COMMANDS_DIR = join(homedir(), ".config", "openagent", "commands");
const PROJECT_COMMANDS_DIR = ".openagent/commands";

const SUPPORTED_EXTENSIONS = [".js", ".ts", ".mjs", ".mts"];

/**
 * Auto-discover command files from global (~/.config/openagent/commands/)
 * and project (.openagent/commands/) directories. Each file must default-export
 * a {@link Command} object. Files are loaded with dynamic import(); project
 * commands override global commands of the same name via registerOrReplace.
 *
 * Errors for individual files are logged to stderr and skipped — a broken
 * command file never prevents other commands or the application from starting.
 */
export async function discoverCommands(cwd: string): Promise<void> {
	const dirs = [GLOBAL_COMMANDS_DIR, join(cwd, PROJECT_COMMANDS_DIR)];

	for (const dir of dirs) {
		if (!existsSync(dir)) continue;

		let names: string[];
		try {
			names = readdirSync(dir);
		} catch {
			continue;
		}

		for (const name of names) {
			const ext = extname(name);
			if (!SUPPORTED_EXTENSIONS.includes(ext)) continue;

			const filePath = join(dir, name);
			try {
				const url = pathToFileURL(filePath).href;
				const mod = await import(url);
				const cmd: Command = mod.default ?? mod;

				if (!cmd || typeof cmd.handler !== "function") {
					console.warn(`[commands] Skipping ${filePath}: no valid handler exported`);
					continue;
				}

				if (!cmd.name) {
					cmd.name = basename(name, ext);
				}

				commandRegistry.registerOrReplace(cmd);
			} catch (err) {
				console.warn(`[commands] Failed to load ${filePath}:`, err);
			}
		}
	}
}
