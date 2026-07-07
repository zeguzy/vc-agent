import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type {
	FileEntry,
	SessionEntry,
	SessionHeader,
	SessionInfo,
} from "@earendil-works/pi-coding-agent";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { buildSqliteUri, sessionsDbPath } from "../utils/paths.js";

/**
 * Drizzle schema for the SQLite session store.
 *
 * Two tables mirror the SDK's `FileEntry[]` model:
 * - `session`: one row per session (header metadata + cwd for filtering)
 * - `entry`:   one row per FileEntry (header at sort_order=0, then entries 1..n)
 *
 * `entry.data` stores the full JSON-serialized FileEntry, so a row round-trips
 * to the exact same object the SDK produced.
 */

export const sessionTable = sqliteTable("session", {
	id: text("id").primaryKey(),
	cwd: text("cwd").notNull(),
	createdAt: text("created_at").notNull(),
	parentSession: text("parent_session"),
	name: text("name"),
});

export const entryTable = sqliteTable(
	"entry",
	{
		id: text("id").notNull(),
		sessionId: text("session_id")
			.notNull()
			.references(() => sessionTable.id),
		sortOrder: integer("sort_order").notNull(),
		type: text("type").notNull(),
		parentId: text("parent_id"),
		timestamp: text("timestamp").notNull(),
		/** Full JSON-serialized FileEntry (header or SessionEntry). */
		data: text("data").notNull(),
	},
	(table) => [primaryKey({ columns: [table.sessionId, table.sortOrder] })],
);

/**
 * Index DDL (declared separately so they can be created with
 * `CREATE INDEX IF NOT EXISTS` regardless of Drizzle's migration tooling).
 */
const ENTRY_INDEX_SQL = "CREATE INDEX IF NOT EXISTS idx_entry_session ON entry(session_id)";
const SESSION_CWD_INDEX_SQL = "CREATE INDEX IF NOT EXISTS idx_session_cwd ON session(cwd)";
const SESSION_CWD_CREATED_INDEX_SQL =
	"CREATE INDEX IF NOT EXISTS idx_session_cwd_created ON session(cwd, created_at DESC)";

const SCHEMA_SESSION_DDL = `
	CREATE TABLE IF NOT EXISTS session (
		id             TEXT PRIMARY KEY,
		cwd            TEXT NOT NULL,
		created_at     TEXT NOT NULL,
		parent_session TEXT,
		name           TEXT
	);
`;

const SCHEMA_ENTRY_DDL = `
	CREATE TABLE IF NOT EXISTS entry (
		id          TEXT NOT NULL,
		session_id  TEXT NOT NULL REFERENCES session(id),
		sort_order  INTEGER NOT NULL,
		type        TEXT NOT NULL,
		parent_id   TEXT,
		timestamp   TEXT NOT NULL,
		data        TEXT NOT NULL,
		PRIMARY KEY (session_id, sort_order)
	);
`;

export interface SessionRow {
	id: string;
	cwd: string;
	createdAt: string;
	parentSession: string | null;
	name: string | null;
}

export interface BulkImportSession {
	sessionId: string;
	cwd: string;
	createdAt: string;
	parentSession?: string;
	entries: FileEntry[];
}

type DrizzleDb = ReturnType<
	typeof drizzle<{
		session: typeof sessionTable;
		entry: typeof entryTable;
	}>
>;

/**
 * Single-instance SQLite-backed session store.
 *
 * Wraps a shared `Database` connection (WAL mode) so concurrent patched
 * SessionManager methods never trip over SQLITE_BUSY. The store is created
 * once via {@link SessionStore.create} (typically inside
 * `installSqliteBackend`) and accessed through the `getOrCreateStore()` helper.
 */
export class SessionStore {
	private readonly db: DrizzleDb;

	private constructor(dbPath: string) {
		mkdirSync(dirname(dbPath), { recursive: true });
		this.db = drizzle(dbPath, {
			schema: { session: sessionTable, entry: entryTable },
		}) as DrizzleDb;
		this.ensureSchema();
		this.db.run("PRAGMA journal_mode = WAL;");
		this.db.run("PRAGMA foreign_keys = ON;");
		this.db.run(ENTRY_INDEX_SQL);
		this.db.run(SESSION_CWD_INDEX_SQL);
		this.db.run(SESSION_CWD_CREATED_INDEX_SQL);
	}

	/**
	 * Create a new SessionStore backed by the default DB path
	 * (`~/.config/openagent/sessions.db`).
	 */
	static create(): SessionStore {
		return new SessionStore(sessionsDbPath());
	}

	/**
	 * Create a SessionStore backed by an explicit DB path (used by tests).
	 */
	static openAt(dbPath: string): SessionStore {
		return new SessionStore(dbPath);
	}

	close(): void {
		// drizzle's bun-sqlite driver exposes the underlying Database via $client.
		const client = (this.db as unknown as { $client: { close(): void } }).$client;
		client.close();
	}

	// ─── Schema bootstrap ──────────────────────────────────

	/**
	 * Ensure the schema tables exist. Idempotent — safe to call on every boot.
	 */
	ensureSchema(): void {
		this.db.run(SCHEMA_SESSION_DDL);
		this.db.run(SCHEMA_ENTRY_DDL);
	}

	// ─── CRUD ──────────────────────────────────────────────

	/**
	 * Insert a session row. Uses INSERT OR IGNORE so repeated calls for the
	 * same id (e.g. createBranchedSession after a partial run) are safe.
	 */
	createSession(id: string, cwd: string, parentSession?: string): void {
		const createdAt = new Date().toISOString();
		this.db
			.insert(sessionTable)
			.values({
				id,
				cwd,
				createdAt,
				parentSession: parentSession ?? null,
				name: null,
			})
			.onConflictDoNothing()
			.run();
	}

	/**
	 * Insert a session row with an explicit createdAt timestamp (used by
	 * bulkImport to preserve the original header timestamp).
	 */
	createSessionWithTimestamp(
		id: string,
		cwd: string,
		createdAt: string,
		parentSession?: string,
	): void {
		this.db
			.insert(sessionTable)
			.values({
				id,
				cwd,
				createdAt,
				parentSession: parentSession ?? null,
				name: null,
			})
			.onConflictDoNothing()
			.run();
	}

	/**
	 * Insert a single entry at the given sort_order. The entry is JSON-serialized
	 * into `entry.data` so it round-trips to the exact same FileEntry object.
	 */
	insertEntry(sessionId: string, sortOrder: number, entry: FileEntry): void {
		const meta = entryMeta(entry);
		this.db
			.insert(entryTable)
			.values({
				id: meta.id,
				sessionId,
				sortOrder,
				type: meta.type,
				parentId: meta.parentId,
				timestamp: meta.timestamp,
				data: JSON.stringify(entry),
			})
			.run();
	}

	/**
	 * Replace all entries for a session in a single transaction.
	 *
	 * Used by compaction (`_rewriteFile`) and createBranchedSession. The
	 * `sort_order` is the array index (0..n-1), matching the convention that
	 * the header is at index 0.
	 */
	rewriteAll(sessionId: string, entries: FileEntry[]): void {
		this.db.transaction((tx) => {
			tx.delete(entryTable).where(eq(entryTable.sessionId, sessionId)).run();
			for (let i = 0; i < entries.length; i++) {
				const meta = entryMeta(entries[i]);
				tx.insert(entryTable)
					.values({
						id: meta.id,
						sessionId,
						sortOrder: i,
						type: meta.type,
						parentId: meta.parentId,
						timestamp: meta.timestamp,
						data: JSON.stringify(entries[i]),
					})
					.run();
			}
		});
	}

	/**
	 * Load all entries for a session ordered by sort_order. The result is the
	 * exact `FileEntry[]` that was originally persisted (header first).
	 */
	loadEntries(sessionId: string): FileEntry[] {
		const rows = this.db
			.select()
			.from(entryTable)
			.where(eq(entryTable.sessionId, sessionId))
			.orderBy(entryTable.sortOrder)
			.all();
		return rows.map((r) => JSON.parse(r.data) as FileEntry);
	}

	/** Return the session row, or undefined if not present. */
	getSession(id: string): SessionRow | undefined {
		const rows = this.db.select().from(sessionTable).where(eq(sessionTable.id, id)).all();
		return rows[0];
	}

	hasSession(id: string): boolean {
		return this.getSession(id) !== undefined;
	}

	setSessionName(id: string, name: string): void {
		this.db.update(sessionTable).set({ name }).where(eq(sessionTable.id, id)).run();
	}

	// ─── Queries ───────────────────────────────────────────

	/** Count of session rows (used by migration to detect "DB empty"). */
	count(): number {
		const rows = this.db.select({ count: sql<number>`count(*)` }).from(sessionTable).all();
		return rows[0]?.count ?? 0;
	}

	/**
	 * Find the most recently created session for a cwd.
	 */
	findRecent(cwd: string): SessionRow | undefined {
		const allRows = this.db.select().from(sessionTable).where(eq(sessionTable.cwd, cwd)).all();
		return allRows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
	}

	/**
	 * List sessions for a cwd as SessionInfo[], sorted by created_at DESC.
	 *
	 * Aggregates entry data per session to compute messageCount / firstMessage /
	 * allMessagesText / modified / name, mirroring the SDK's JSONL-based
	 * buildSessionInfo.
	 */
	listSessions(cwd: string): SessionInfo[] {
		const sessions = this.db
			.select()
			.from(sessionTable)
			.where(eq(sessionTable.cwd, cwd))
			.all()
			.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

		return sessions.map((s) => this.buildSessionInfo(s));
	}

	/**
	 * List all sessions across all cwds (used by patched `SessionManager.listAll`).
	 */
	listAllSessions(): SessionInfo[] {
		const sessions = this.db
			.select()
			.from(sessionTable)
			.all()
			.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
		return sessions.map((s) => this.buildSessionInfo(s));
	}

	private buildSessionInfo(s: SessionRow): SessionInfo {
		const entries = this.loadEntries(s.id);
		const header = entries.find((e): e is SessionHeader => e.type === "session");

		let messageCount = 0;
		let firstMessage = "";
		const allMessages: string[] = [];
		let name = s.name ?? undefined;
		let lastActivityTime: number | undefined;

		for (const entry of entries) {
			if (entry.type === "session") continue;
			if (entry.type === "session_info") {
				name = entry.name?.trim() || name;
				continue;
			}
			if (entry.type !== "message") continue;
			messageCount++;
			const activityTime = getMessageActivityTime(entry);
			if (typeof activityTime === "number") {
				lastActivityTime = Math.max(lastActivityTime ?? 0, activityTime);
			}
			const message = entry.message as MessageLike;
			if (!isMessageWithContent(message)) continue;
			if (message.role !== "user" && message.role !== "assistant") continue;
			const text = extractTextContent(message);
			if (!text) continue;
			allMessages.push(text);
			if (!firstMessage && message.role === "user") {
				firstMessage = text;
			}
		}

		const headerTime = header ? new Date(header.timestamp).getTime() : NaN;
		const created = header ? new Date(header.timestamp) : new Date(s.createdAt);
		const modified =
			typeof lastActivityTime === "number" && lastActivityTime > 0
				? new Date(lastActivityTime)
				: !Number.isNaN(headerTime)
					? new Date(headerTime)
					: new Date(s.createdAt);

		return {
			path: buildSqliteUri(s.id),
			id: s.id,
			cwd: s.cwd,
			name,
			parentSessionPath: s.parentSession ?? header?.parentSession ?? undefined,
			created,
			modified,
			messageCount,
			firstMessage: firstMessage || "(no messages)",
			allMessagesText: allMessages.join(" "),
		};
	}

	// ─── Bulk import (migration) ───────────────────────────

	/**
	 * Bulk-import multiple sessions in a single transaction.
	 *
	 * Each session's entries are inserted with sort_order = array index. The
	 * header (first entry, type="session") must be present. On any failure the
	 * whole transaction is rolled back so the DB stays empty / unchanged.
	 */
	bulkImport(sessions: BulkImportSession[]): void {
		this.db.transaction((tx) => {
			for (const s of sessions) {
				const header = s.entries.find((e): e is SessionHeader => e.type === "session");
				if (!header) {
					throw new Error(`bulkImport: session ${s.sessionId} has no header entry`);
				}
				tx.insert(sessionTable)
					.values({
						id: s.sessionId,
						cwd: s.cwd,
						createdAt: s.createdAt,
						parentSession: s.parentSession ?? null,
						name: null,
					})
					.onConflictDoNothing()
					.run();
				for (let i = 0; i < s.entries.length; i++) {
					const meta = entryMeta(s.entries[i]);
					tx.insert(entryTable)
						.values({
							id: meta.id,
							sessionId: s.sessionId,
							sortOrder: i,
							type: meta.type,
							parentId: meta.parentId,
							timestamp: meta.timestamp,
							data: JSON.stringify(s.entries[i]),
						})
						.run();
				}
			}
		});
	}
}

// ─── Helpers (mirror SDK's buildSessionInfo internals) ─────────

interface EntryMeta {
	id: string;
	type: string;
	parentId: string | null;
	timestamp: string;
}

function entryMeta(entry: FileEntry): EntryMeta {
	if (entry.type === "session") {
		return {
			id: entry.id,
			type: entry.type,
			parentId: null,
			timestamp: entry.timestamp,
		};
	}
	const e = entry as SessionEntry;
	return {
		id: e.id,
		type: e.type,
		parentId: e.parentId,
		timestamp: e.timestamp,
	};
}

interface MessageLike {
	role?: string;
	content?: unknown;
	timestamp?: number;
}

function isMessageWithContent(
	message: MessageLike,
): message is MessageLike & { role: string; content: unknown } {
	return typeof message.role === "string" && "content" in message;
}

function extractTextContent(message: { content: unknown }): string {
	const content = message.content;
	if (typeof content === "string") {
		return content;
	}
	if (!Array.isArray(content)) return "";
	return content
		.filter((block: { type?: string; text?: string }) => block.type === "text")
		.map((block: { text?: string }) => block.text ?? "")
		.join(" ");
}

function getMessageActivityTime(entry: SessionEntry): number | undefined {
	if (entry.type !== "message") return undefined;
	const message = entry.message as MessageLike;
	if (!isMessageWithContent(message)) return undefined;
	if (message.role !== "user" && message.role !== "assistant") return undefined;
	const msgTimestamp = message.timestamp;
	if (typeof msgTimestamp === "number") {
		return msgTimestamp;
	}
	const t = new Date(entry.timestamp).getTime();
	return Number.isNaN(t) ? undefined : t;
}
