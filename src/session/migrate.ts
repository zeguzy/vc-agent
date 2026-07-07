/**
 * migrate — one-shot JSONL → SQLite migration + team directory relocation.
 *
 * Runs inside `installSqliteBackend()` on first boot. Idempotent: if the DB
 * already has session rows the whole flow is skipped.
 */

import {
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readdirSync,
	readSync,
	renameSync,
	statSync,
} from "node:fs";
import { join } from "node:path";
import type { FileEntry, SessionHeader } from "@earendil-works/pi-coding-agent";
import {
	sessionsBackupDir,
	sessionsLegacyDir,
	teamDir,
	teamDirForSession,
} from "../utils/paths.js";
import type { BulkImportSession, SessionStore } from "./sqlite-store.js";

const READ_BUFFER_SIZE = 64 * 1024;

/**
 * Parse a `.jsonl` session file into `FileEntry[]`.
 *
 * Mirrors the SDK's `loadEntriesFromFile` (which is not exported via the
 * package's `exports` map). Returns `[]` if the file does not exist or the
 * first line is not a valid session header.
 */
function parseJsonlFile(filePath: string): FileEntry[] {
	if (!existsSync(filePath)) return [];
	const entries: FileEntry[] = [];
	const fd = openSync(filePath, "r");
	try {
		const buffer = Buffer.allocUnsafe(READ_BUFFER_SIZE);
		let pending = "";
		while (true) {
			const n = readSync(fd, buffer, 0, buffer.length, null);
			if (n === 0) break;
			pending += buffer.subarray(0, n).toString("utf8");
			let start = 0;
			let nl = pending.indexOf("\n", start);
			while (nl !== -1) {
				const line = pending.slice(start, nl).trim();
				if (line) {
					try {
						entries.push(JSON.parse(line) as FileEntry);
					} catch {
						// skip malformed line
					}
				}
				start = nl + 1;
				nl = pending.indexOf("\n", start);
			}
			pending = pending.slice(start);
		}
		if (pending.trim()) {
			try {
				entries.push(JSON.parse(pending.trim()) as FileEntry);
			} catch {
				// trailing partial line
			}
		}
	} finally {
		closeSync(fd);
	}
	// Validate header
	if (entries.length === 0) return [];
	const header = entries[0];
	if (header.type !== "session" || typeof header.id !== "string") return [];
	return entries;
}

/**
 * Import a single `.jsonl` file into the DB. Used by patched
 * `SessionManager.open` for the `/import` command path.
 *
 * Returns the sessionId (header.id).
 */
export function importJsonlToDb(store: SessionStore, jsonlPath: string): string {
	const entries = parseJsonlFile(jsonlPath);
	if (entries.length === 0) {
		throw new Error(`[migrate] failed to parse or empty: ${jsonlPath}`);
	}
	const header = entries.find((e): e is SessionHeader => e.type === "session");
	if (!header) {
		throw new Error(`[migrate] no session header in: ${jsonlPath}`);
	}
	const session: BulkImportSession = {
		sessionId: header.id,
		cwd: header.cwd ?? process.cwd(),
		createdAt: header.timestamp,
		parentSession: header.parentSession,
		entries,
	};
	store.bulkImport([session]);
	return header.id;
}

/**
 * Detect whether migration is needed (DB empty + legacy `.jsonl` files exist)
 * and run it. Idempotent.
 */
export async function migrateIfNeeded(store: SessionStore): Promise<void> {
	if (store.count() > 0) return; // DB already populated

	const legacyDir = sessionsLegacyDir();
	if (!existsSync(legacyDir)) return;

	// Collect all .jsonl files under sessions/<cwd-hash>/*.jsonl
	const jsonlFiles = collectJsonlFiles(legacyDir);
	if (jsonlFiles.length === 0) return;

	// Parse all sessions first; abort if any file fails (single transaction).
	const sessions: BulkImportSession[] = [];
	for (const file of jsonlFiles) {
		const entries = parseJsonlFile(file);
		if (entries.length === 0) continue; // skip empty/corrupt silently
		const header = entries.find((e): e is SessionHeader => e.type === "session");
		if (!header) continue;
		sessions.push({
			sessionId: header.id,
			cwd: header.cwd ?? process.cwd(),
			createdAt: header.timestamp,
			parentSession: header.parentSession,
			entries,
		});
	}
	if (sessions.length === 0) return;

	// Single-transaction bulk import.
	store.bulkImport(sessions);

	// Relocate team directories BEFORE renaming sessions/ (paths still valid).
	relocateTeamDirectories(legacyDir);

	// Rename sessions/ → sessions.bak/ (error if already exists).
	const backupDir = sessionsBackupDir();
	if (existsSync(backupDir)) {
		// DB data already committed; leave sessions/ in place and warn.
		console.warn(
			`[migrate] sessions.bak/ already exists; leaving sessions/ in place. ` +
				`Manually remove it if you want to re-run migration.`,
		);
		return;
	}
	renameSync(legacyDir, backupDir);
}

/** Recursively collect all `.jsonl` files under `dir`. */
function collectJsonlFiles(dir: string): string[] {
	const results: string[] = [];
	if (!existsSync(dir)) return results;
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		const stat = statSync(full);
		if (stat.isDirectory()) {
			results.push(...collectJsonlFiles(full));
		} else if (entry.endsWith(".jsonl")) {
			results.push(full);
		}
	}
	return results;
}

/**
 * Move team member directories from the old nested location
 * (`sessions/<cwd-hash>/team/<sessionId>/`) to the new top-level location
 * (`team/<sessionId>/`).
 *
 * Each subdirectory is moved independently (idempotent: if the target already
 * exists, that subdirectory is skipped), so a partial failure can be retried.
 */
function relocateTeamDirectories(legacyDir: string): void {
	const newTeamRoot = teamDir();
	mkdirSync(newTeamRoot, { recursive: true });

	for (const entry of readdirSync(legacyDir)) {
		const cwdHashDir = join(legacyDir, entry);
		if (!statSync(cwdHashDir).isDirectory()) continue;
		const oldTeamRoot = join(cwdHashDir, "team");
		if (!existsSync(oldTeamRoot)) continue;

		for (const sessionId of readdirSync(oldTeamRoot)) {
			const src = join(oldTeamRoot, sessionId);
			if (!statSync(src).isDirectory()) continue;
			const dst = teamDirForSession(sessionId);
			if (existsSync(dst)) continue; // idempotent: skip already-moved
			mkdirSync(dst, { recursive: true });
			// Move contents recursively.
			for (const item of readdirSync(src)) {
				renameSync(join(src, item), join(dst, item));
			}
		}
	}
}
