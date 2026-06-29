import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const HISTORY_PATH = join(homedir(), ".config", "openagent", "history");

function ensureDir(filePath: string): void {
	const dir = dirname(filePath);
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
}

/**
 * Load command history from disk.
 * Returns array of history entries (one per line), or empty array if file doesn't exist.
 */
export function loadHistory(): string[] {
	if (!existsSync(HISTORY_PATH)) return [];
	const raw = readFileSync(HISTORY_PATH, "utf-8");
	return raw.split("\n").filter((line) => line.length > 0);
}

/**
 * Append a command to the history file, deduplicating consecutive identical entries.
 */
export function saveHistory(entry: string): void {
	ensureDir(HISTORY_PATH);

	// Deduplicate consecutive identical entries
	const existing = loadHistory();
	if (existing.length > 0 && existing[existing.length - 1] === entry) return;

	// Limit history to 1000 entries (trim oldest if needed)
	if (existing.length >= 1000) {
		const trimmed = existing.slice(-999);
		// Re-write entire file (appendFileSync alone won't trim)
		const { writeFileSync } = require("node:fs") as typeof import("node:fs");
		writeFileSync(HISTORY_PATH, `${trimmed.join("\n")}\n${entry}\n`, "utf-8");
	} else {
		appendFileSync(HISTORY_PATH, `${entry}\n`, "utf-8");
	}
}
