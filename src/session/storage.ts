import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Subdirectory name under the openagent config root used for session storage.
 */
export const SESSIONS_DIR_NAME = "sessions";

/**
 * Pure path resolver for the session storage root.
 *
 * Accepts an optional `home` override so the path-construction logic can be
 * unit-tested without touching the real filesystem.
 */
export function sessionDirRoot(home: string = homedir()): string {
	return join(home, ".config", "openagent", SESSIONS_DIR_NAME);
}

/**
 * Resolve the session storage directory, creating it (recursively) if missing.
 *
 * This is the value passed as `sessionDir` to `SessionManager.create` /
 * `open` / `continueRecent` / `list`. Writing under openagent's own config
 * root keeps session data out of `~/.pi/` (see design.md Decision 2).
 */
export function resolveSessionDir(): string {
	const dir = sessionDirRoot();
	mkdirSync(dir, { recursive: true });
	return dir;
}
