import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { Config } from "./config.js";

const GLOBAL_AGENTS = join(homedir(), ".config", "openagent", "AGENTS.md");
const CLAUDE_GLOBAL = join(homedir(), ".claude", "CLAUDE.md");

const BASE_SYSTEM_PROMPT = [
	"You are openagent, a terminal coding assistant.",
	"You help users by reading files, executing commands, editing code, and writing new files.",
	"",
	"Guidelines:",
	"- Be concise in your responses.",
	"- Show file paths clearly when working with files.",
	"- When a task involves multiple steps, break it down and work through it methodically.",
].join("\n");

/**
 * Walk up the directory tree from `startDir` looking for the first file
 * that matches one of `filenames`. Stops at the filesystem root.
 * Returns the absolute path of the first match, or undefined.
 */
function findUp(startDir: string, filenames: string[]): string | undefined {
	let current = resolve(startDir);
	while (true) {
		for (const name of filenames) {
			const candidate = join(current, name);
			if (existsSync(candidate)) return candidate;
		}
		const parent = dirname(current);
		if (parent === current) break; // reached filesystem root
		current = parent;
	}
	return undefined;
}

/**
 * Read a file and return its content, or empty string if the file doesn't exist.
 */
function readFileSafe(filePath: string): string {
	try {
		if (!existsSync(filePath)) return "";
		return readFileSync(filePath, "utf-8");
	} catch {
		return "";
	}
}

/**
 * Fetch content from an HTTP(S) URL with a 5-second timeout.
 * Returns empty string on failure.
 */
async function fetchUrl(url: string): Promise<string> {
	try {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 5000);
		const res = await fetch(url, { signal: controller.signal });
		clearTimeout(timer);
		if (!res.ok) return "";
		return await res.text();
	} catch {
		return "";
	}
}

/**
 * Resolve instructions from the config (relative paths, ~/, globs, URLs).
 * Returns resolved absolute file paths and URL strings.
 */
async function resolveInstructions(
	config: Config,
	cwd: string,
	home: string,
): Promise<{ files: string[]; urls: string[] }> {
	const instructions = config.instructions ?? [];
	const files: string[] = [];
	const urls: string[] = [];

	for (const raw of instructions) {
		if (raw.startsWith("http://") || raw.startsWith("https://")) {
			urls.push(raw);
			continue;
		}

		const expanded = raw.startsWith("~/") ? join(home, raw.slice(2)) : raw;

		if (isAbsolute(expanded)) {
			files.push(expanded);
			continue;
		}

		// Relative path or glob: resolve via findUp
		const found = findUp(cwd, [expanded]);
		if (found) {
			files.push(found);
		}
	}

	return { files, urls };
}

/**
 * Load the full system context by combining:
 * 1. Base system prompt
 * 2. Global AGENTS.md (or ~/.claude/CLAUDE.md fallback)
 * 3. Project-level AGENTS.md (or CLAUDE.md fallback), found via findUp from cwd
 * 4. Instructions from config (files + URLs)
 */
export async function loadSystemContext(cwd: string, config: Config): Promise<string> {
	const parts: string[] = [BASE_SYSTEM_PROMPT];

	// Global AGENTS.md
	const globalFile = existsSync(GLOBAL_AGENTS) ? GLOBAL_AGENTS : CLAUDE_GLOBAL;
	const globalContent = readFileSafe(globalFile);
	if (globalContent) {
		parts.push(`\nInstructions from: ${globalFile}\n${globalContent}`);
	}

	// Project-level AGENTS.md or CLAUDE.md (first match wins)
	const projectFile = findUp(cwd, ["AGENTS.md", "CLAUDE.md"]);
	if (projectFile) {
		const projectContent = readFileSafe(projectFile);
		if (projectContent) {
			parts.push(`\nInstructions from: ${projectFile}\n${projectContent}`);
		}
	}

	// Config instructions: files + URLs
	const { files, urls } = await resolveInstructions(config, cwd, homedir());

	for (const file of files) {
		const content = readFileSafe(file);
		if (content) {
			parts.push(`\nInstructions from: ${file}\n${content}`);
		}
	}

	for (const url of urls) {
		const content = await fetchUrl(url);
		if (content) {
			parts.push(`\nInstructions from: ${url}\n${content}`);
		}
	}

	return parts.join("\n");
}

/**
 * Given a file path that the agent is about to read, walk up from that file's
 * directory and find any AGENTS.md files in parent directories that aren't
 * already loaded in `loadedPaths`. Returns discovered files with their content.
 * Deduplicates: each file returned at most once per call.
 */
export function resolveNearbyContext(
	filePath: string,
	cwd: string,
	loadedPaths: Set<string>,
): { filePath: string; content: string }[] {
	const results: { filePath: string; content: string }[] = [];
	const seen = new Set<string>();
	const root = resolve(cwd);
	let current = dirname(resolve(filePath));

	while (current.startsWith(root)) {
		const candidate = join(current, "AGENTS.md");
		if (!loadedPaths.has(candidate) && !seen.has(candidate) && existsSync(candidate)) {
			seen.add(candidate);
			const content = readFileSafe(candidate);
			if (content) {
				results.push({ filePath: candidate, content });
			}
		}
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}

	return results;
}
