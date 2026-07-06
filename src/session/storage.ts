import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, normalize, relative } from "node:path";

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

export function resolveMemberSessionPath(sessionId: string): string {
	return join(sessionDirRoot(), `${sessionId}.jsonl`);
}

const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function validateSessionId(sessionId: string): boolean {
	if (sessionId.includes("/") || sessionId.includes("..")) return false;
	if (sessionId.endsWith(".jsonl")) return false;
	return TIMESTAMP_RE.test(sessionId) || UUID_RE.test(sessionId);
}

export function validateMemberSessionPath(resolvedPath: string): boolean {
	const root = sessionDirRoot();
	if (!resolvedPath.startsWith(root)) return false;
	const rel = relative(root, normalize(resolvedPath));
	if (rel.startsWith("..")) return false;
	return true;
}
