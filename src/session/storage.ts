import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, normalize, relative } from "node:path";
import {
	buildSqliteUri,
	isSqliteUri,
	parseSessionIdFromUri,
	sessionDirRoot as pathsSessionDirRoot,
	SESSIONS_DIR_NAME,
} from "../utils/paths.js";

export { buildSqliteUri, isSqliteUri, parseSessionIdFromUri, SESSIONS_DIR_NAME };

/**
 * Pure path resolver for the legacy session storage root.
 *
 * Accepts an optional `home` override so the path-construction logic can be
 * unit-tested without touching the real filesystem.
 */
export function sessionDirRoot(home: string = homedir()): string {
	return pathsSessionDirRoot(home);
}

/**
 * Resolve the session storage directory, creating it (recursively) if missing.
 *
 * After the SQLite migration, sessions are stored in `~/.config/openagent/sessions.db`.
 * This directory is only created for backwards-compatibility callers that have
 * not yet been migrated; new sessions never write to it.
 */
export function resolveSessionDir(): string {
	const dir = sessionDirRoot();
	mkdirSync(dir, { recursive: true });
	return dir;
}

/**
 * @deprecated SQLite migration replaces this with `sqlite://<sessionId>` URIs.
 * Kept for transitional callers; will be removed once all call sites are updated.
 */
export function resolveMemberSessionPath(sessionId: string): string {
	return join(sessionDirRoot(), `${sessionId}.jsonl`);
}

const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function validateSessionId(sessionId: string): boolean {
	if (!sessionId) return false;
	if (sessionId.includes("/") || sessionId.includes("..")) return false;
	if (sessionId.endsWith(".jsonl")) return false;
	// Allow timestamp-prefixed ids (legacy SDK format) and any UUID-like id
	// (covers both uuidv4 and uuidv7).
	return TIMESTAMP_RE.test(sessionId) || UUID_RE.test(sessionId);
}

/**
 * @deprecated SQLite migration makes path-based validation obsolete. Use
 * {@link validateSessionId} instead.
 */
export function validateMemberSessionPath(resolvedPath: string): boolean {
	const root = sessionDirRoot();
	if (!resolvedPath.startsWith(root)) return false;
	const rel = relative(root, normalize(resolvedPath));
	if (rel.startsWith("..")) return false;
	return true;
}
