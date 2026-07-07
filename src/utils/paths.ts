import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Centralized path module for the openagent config root and its sub-paths.
 *
 * All `~/.config/openagent/...` path construction should go through here so
 * future XDG migration only needs to update this single module.
 *
 * Resolvers accept an optional `home` override so they can be unit-tested
 * without touching the real filesystem.
 */

/** Top-level config directory name under `$HOME/.config`. */
export const AGENT_DIR_NAME = "openagent";

/** Legacy JSONL sessions directory name (now renamed to `sessions.bak/`). */
export const SESSIONS_DIR_NAME = "sessions";

/** Backup directory name for the renamed legacy sessions directory. */
export const SESSIONS_BACKUP_DIR_NAME = "sessions.bak";

/** SQLite database file name. */
export const SESSIONS_DB_NAME = "sessions.db";

/** Team directory name (top-level under config root). */
export const TEAM_DIR_NAME = "team";

/** `sqlite://<sessionId>` URI scheme used as the synthetic sessionFile. */
export const SQLITE_URI_SCHEME = "sqlite://";

/**
 * Pure resolver for the openagent config root: `~/.config/openagent`.
 *
 * Accepts an optional `home` override so the path-construction logic can be
 * unit-tested without touching the real filesystem.
 */
export function agentConfigDir(home: string = homedir()): string {
	return join(home, ".config", AGENT_DIR_NAME);
}

/**
 * Path to the single SQLite database file: `~/.config/openagent/sessions.db`.
 */
export function sessionsDbPath(home: string = homedir()): string {
	return join(agentConfigDir(home), SESSIONS_DB_NAME);
}

/**
 * Path to the legacy JSONL sessions directory: `~/.config/openagent/sessions`.
 *
 * After migration this directory is renamed to `sessions.bak/` (see
 * {@link sessionsBackupDir}). Use this resolver to detect whether migration
 * is needed (directory still present with `.jsonl` files).
 */
export function sessionsLegacyDir(home: string = homedir()): string {
	return join(agentConfigDir(home), SESSIONS_DIR_NAME);
}

/**
 * Alias for {@link sessionsLegacyDir}. Kept for backwards compatibility with
 * callers that pre-date the SQLite migration.
 */
export const sessionDirRoot = sessionsLegacyDir;

/**
 * Path to the renamed legacy sessions directory: `~/.config/openagent/sessions.bak`.
 *
 * The migration renames `sessions/` to this name to preserve original JSONL
 * data after import. If this already exists when migration runs, the migration
 * reports an error to avoid clobbering a user's manual backup.
 */
export function sessionsBackupDir(home: string = homedir()): string {
	return join(agentConfigDir(home), SESSIONS_BACKUP_DIR_NAME);
}

/**
 * Path to the top-level team directory: `~/.config/openagent/team`.
 *
 * Member memory/index/TEAM.md for a specific session live under
 * `<teamDir>/<sessionId>/`. Use {@link teamDirForSession} to construct the
 * per-session path.
 */
export function teamDir(home: string = homedir()): string {
	return join(agentConfigDir(home), TEAM_DIR_NAME);
}

/**
 * Path to a specific session's team directory:
 * `~/.config/openagent/team/<sessionId>`.
 *
 * This is the new location after the SQLite migration (the old location was
 * `sessions/<cwd-hash>/team/<sessionId>/`, which became invalid after
 * `sessions/` was renamed to `sessions.bak/`).
 */
export function teamDirForSession(sessionId: string, home: string = homedir()): string {
	return join(teamDir(home), sessionId);
}

/** Prefix used by SQLite-mode synthetic sessionFile values. */
const SQLITE_URI_PREFIX = SQLITE_URI_SCHEME;

/**
 * Parse the `<sessionId>` portion out of a `sqlite://<sessionId>` URI.
 *
 * Returns the sessionId unchanged if the input is not a `sqlite://` URI
 * (defensive: callers may pass either the URI form or a raw id).
 *
 * @throws if the URI is malformed (empty sessionId after the prefix).
 */
export function parseSessionIdFromUri(sessionFile: string): string {
	if (!sessionFile) {
		throw new Error("parseSessionIdFromUri: empty sessionFile");
	}
	if (sessionFile.startsWith(SQLITE_URI_PREFIX)) {
		const id = sessionFile.slice(SQLITE_URI_PREFIX.length);
		if (!id) {
			throw new Error(`parseSessionIdFromUri: malformed sqlite uri: ${sessionFile}`);
		}
		return id;
	}
	// Not a sqlite:// uri — assume caller already passed a raw sessionId.
	return sessionFile;
}

/**
 * Build a `sqlite://<sessionId>` URI from a sessionId.
 */
export function buildSqliteUri(sessionId: string): string {
	return `${SQLITE_URI_PREFIX}${sessionId}`;
}

/**
 * Returns true if the given sessionFile is a `sqlite://` URI.
 */
export function isSqliteUri(sessionFile: string): boolean {
	return sessionFile.startsWith(SQLITE_URI_PREFIX);
}
