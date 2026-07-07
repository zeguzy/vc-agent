/**
 * Centralized access to Pi SDK `SessionManager` private fields.
 *
 * The wrapper monkey-patches prototype/staticmethods and needs to read/write
 * internals that the SDK declares `private`. All such access goes through
 * this module so an SDK upgrade only needs to update one place.
 */
import type {
	FileEntry,
	SessionEntry,
	SessionHeader,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import type { SessionStore } from "./sqlite-store.js";

/** Shape of the private fields the patch reads/writes. */
export interface SdkInternals {
	sessionId: string;
	sessionFile: string | undefined;
	sessionDir: string;
	cwd: string;
	persist: boolean;
	flushed: boolean;
	fileEntries: FileEntry[];
	byId: Map<string, SessionEntry>;
	leafId: string | null;
}

/**
 * Cast a `SessionManager` instance to expose its private fields.
 *
 * This intentionally uses `as unknown as` — the SDK marks these fields
 * `private` but they exist at runtime. The shape is verified at boot via
 * `assertSdkStructure`.
 */
export function getSdkInternals(inst: SessionManager): SdkInternals {
	return inst as unknown as SdkInternals;
}

/** Per-instance flag key used to mark SQLite-mode instances. */
const STORE_KEY = "__sqliteStore" as const;

/** Attach the SessionStore to an instance so patched methods detect it. */
export function setSqliteStore(inst: SessionManager, store: SessionStore): void {
	(inst as unknown as Record<string, unknown>)[STORE_KEY] = store;
}

/** Return the SessionStore if the instance is in SQLite mode, else undefined. */
export function getSqliteStore(inst: SessionManager): SessionStore | undefined {
	return (inst as unknown as Record<string, unknown>)[STORE_KEY] as SessionStore | undefined;
}

/**
 * Lazy-create the session record + header entry on first `_persist`/`_rewriteFile`.
 *
 * Idempotent: if the session row already exists, does nothing. This is the
 * crux of the "lazy create" strategy — patched `newSession` does NOT write to
 * DB (to avoid orphan records when newSession is called multiple times), so
 * the first real write must bootstrap the session row + header entry.
 */
export function ensureSessionRecord(store: SessionStore, internals: SdkInternals): void {
	const sid = internals.sessionId;
	if (store.hasSession(sid)) return;
	const header = internals.fileEntries.find((e): e is SessionHeader => e.type === "session");
	store.createSession(sid, internals.cwd, header?.parentSession);
	if (header) {
		store.insertEntry(sid, 0, header);
	}
}
