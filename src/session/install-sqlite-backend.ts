/**
 * installSqliteBackend — one-shot class-level monkey-patch that replaces
 * Pi SDK's JSONL persistence with SQLite.
 *
 * MUST be awaited at the top of `createRuntime` before any
 * `SessionManager.create/open/continueRecent` call (including those inside
 * SDK's own `AgentSessionRuntime`).
 *
 * Architecture (see design.md for full detail):
 * - Patches `SessionManager.prototype` (6 methods) + static methods so that
 *   every call path — including SDK runtime's internal `/new` `/fork` `/import`
 *   — is covered.
 * - SQLite-mode instances carry a `__sqliteStore` flag; patched methods check
 *   it and either delegate to SQLite or fall through to the SDK original.
 * - DB writes use a "lazy create" strategy: `newSession` only sets
 *   `sessionFile` in memory; the session row + header entry are created on
 *   the first `_persist`/`_rewriteFile` call, so multiple `newSession` calls
 *   never produce orphan DB records.
 */
import {
	type SessionEntry,
	type SessionHeader,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { buildSqliteUri, isSqliteUri, parseSessionIdFromUri } from "../utils/paths.js";
import { importJsonlToDb, migrateIfNeeded } from "./migrate.js";
import {
	ensureSessionRecord,
	getSdkInternals,
	getSqliteStore,
	type SdkInternals,
	setSqliteStore,
} from "./sdk-internals.js";
import { SessionStore } from "./sqlite-store.js";

// ─── Singleton store ────────────────────────────────────────

let store: SessionStore | undefined;
let installed = false;

/**
 * Return the singleton SessionStore.
 *
 * Synchronous by design: `installSqliteBackend()` completes (and initialises
 * the store) before any patched method is reachable, so callers never wait.
 */
export function getOrCreateStore(): SessionStore {
	if (!store) throw new Error("installSqliteBackend() has not been called yet");
	return store;
}

// ─── SDK structure assertion ────────────────────────────────

/**
 * Verify the SDK's SessionManager still has the private fields / methods the
 * patch depends on. Runs once at install time; throws with a helpful message
 * (including the SDK version) if the shape has drifted.
 */
function assertSdkStructure(SM: typeof SessionManager): void {
	const proto = SM.prototype;
	const requiredProto = [
		"_persist",
		"_rewriteFile",
		"setSessionFile",
		"newSession",
		"createBranchedSession",
		"isPersisted",
	] as const;
	for (const name of requiredProto) {
		if (typeof (proto as unknown as Record<string, unknown>)[name] !== "function") {
			throw new Error(
				`[sqlite-backend] SDK drift: SessionManager.prototype.${name} is missing. ` +
					`Pinned SDK version may need updating.`,
			);
		}
	}
	const requiredStatic = [
		"create",
		"open",
		"continueRecent",
		"inMemory",
		"list",
		"listAll",
	] as const;
	for (const name of requiredStatic) {
		if (typeof (SM as unknown as Record<string, unknown>)[name] !== "function") {
			throw new Error(
				`[sqlite-backend] SDK drift: SessionManager.${name} is missing. ` +
					`Pinned SDK version may need updating.`,
			);
		}
	}
	// Spot-check an inMemory instance has the private fields we read/write.
	const probe = SM.inMemory("/__sqlite_probe__");
	const internals = getSdkInternals(probe);
	const requiredFields: (keyof SdkInternals)[] = [
		"sessionId",
		"sessionFile",
		"cwd",
		"persist",
		"flushed",
		"fileEntries",
		"byId",
		"leafId",
	];
	for (const f of requiredFields) {
		if (!(f in internals)) {
			throw new Error(
				`[sqlite-backend] SDK drift: SessionManager instance missing field '${f}'. ` +
					`Pinned SDK version may need updating.`,
			);
		}
	}
}

// ─── Prototype patching ─────────────────────────────────────

function patchPrototype(proto: typeof SessionManager.prototype): void {
	// Typed shim for accessing the SDK's private methods on the prototype.
	type PrivateProto = {
		_persist: (entry: SessionEntry) => void;
		_rewriteFile: () => void;
		setSessionFile: (sessionFile: string) => void;
		newSession: (options?: { id?: string; parentSession?: string }) => string | undefined;
		createBranchedSession: (leafId: string) => string | undefined;
		_buildIndex: () => void;
	};
	const p = proto as unknown as PrivateProto;
	// Save originals so non-SQLite instances fall through unchanged.
	const originalPersist = p._persist;
	const originalRewrite = p._rewriteFile;
	const originalSetSessionFile = p.setSessionFile;
	const originalNewSession = p.newSession;
	const originalCreateBranched = p.createBranchedSession;

	// `_persist(entry)` — lazy create session record + header, then insert entry.
	p._persist = function persist(this: SessionManager, entry: SessionEntry): void {
		const sqliteStore = getSqliteStore(this);
		if (!sqliteStore) {
			originalPersist.call(this, entry);
			return;
		}
		const internals = getSdkInternals(this);
		ensureSessionRecord(sqliteStore, internals);
		const sortOrder = internals.fileEntries.length - 1;
		sqliteStore.insertEntry(internals.sessionId, sortOrder, entry);
	};

	// `_rewriteFile()` — lazy create, then transactional DELETE + INSERT ALL.
	p._rewriteFile = function rewriteFile(this: SessionManager): void {
		const sqliteStore = getSqliteStore(this);
		if (!sqliteStore) {
			originalRewrite.call(this);
			return;
		}
		const internals = getSdkInternals(this);
		ensureSessionRecord(sqliteStore, internals);
		sqliteStore.rewriteAll(internals.sessionId, internals.fileEntries);
	};

	// `setSessionFile(uri)` — load entries from DB + rebuild SDK index.
	p.setSessionFile = function setSessionFile(this: SessionManager, sessionFile: string): void {
		const sqliteStore = getSqliteStore(this);
		// Defensive: SDK may invoke with undefined during construction.
		if (!sqliteStore || !sessionFile) {
			originalSetSessionFile.call(this, sessionFile);
			return;
		}
		const internals = getSdkInternals(this);
		const sessionId = parseSessionIdFromUri(sessionFile);
		const entries = sqliteStore.loadEntries(sessionId);
		if (entries.length === 0) {
			throw new Error(`[sqlite-backend] session ${sessionId} has no entries (DB corrupted?)`);
		}
		internals.sessionFile = sessionFile;
		internals.fileEntries = entries;
		internals.sessionId = sessionId;
		internals.flushed = true;
		// Reuse SDK's native _buildIndex to rebuild all 4 in-memory indexes.
		p._buildIndex.call(this);
	};

	// `newSession(options?)` — only set sessionFile, do NOT write DB (lazy create).
	p.newSession = function newSession(
		this: SessionManager,
		options?: { id?: string; parentSession?: string },
	): string | undefined {
		const sqliteStore = getSqliteStore(this);
		if (!sqliteStore) return originalNewSession.call(this, options);
		originalNewSession.call(this, options);
		const internals = getSdkInternals(this);
		const uri = buildSqliteUri(internals.sessionId);
		internals.sessionFile = uri;
		// SDK persist=false may leave header.parentSession undefined; patch it
		// so lazy-create picks up the right parent (fork-no-targetLeaf path).
		if (options?.parentSession) {
			const header = internals.fileEntries.find((e): e is SessionHeader => e.type === "session");
			if (header) header.parentSession = options.parentSession;
		}
		return uri;
	};

	// `createBranchedSession(leafId)` — save parent, patch header, DB branch.
	p.createBranchedSession = function createBranchedSession(
		this: SessionManager,
		leafId: string,
	): string | undefined {
		const sqliteStore = getSqliteStore(this);
		if (!sqliteStore) return originalCreateBranched.call(this, leafId);
		const parentSessionId = getSdkInternals(this).sessionId;
		originalCreateBranched.call(this, leafId);
		const internals = getSdkInternals(this);
		const newSessionId = internals.sessionId;
		const uri = buildSqliteUri(newSessionId);
		internals.sessionFile = uri;
		// SDK in-memory branch constructs header.parentSession=undefined; patch.
		const header = internals.fileEntries.find((e): e is SessionHeader => e.type === "session");
		if (header) header.parentSession = parentSessionId;
		sqliteStore.createSession(newSessionId, internals.cwd, parentSessionId);
		sqliteStore.rewriteAll(newSessionId, internals.fileEntries);
		return uri;
	};

	// `isPersisted()` — return true so SDK runtime routes to patched statics.
	proto.isPersisted = function isPersisted(this: SessionManager): boolean {
		if (getSqliteStore(this)) return true;
		return getSdkInternals(this).persist;
	};
}

// ─── Static method patching ─────────────────────────────────

function patchStatic(SM: typeof SessionManager): void {
	// `create(cwd)` — synchronous; inMemory + attach store, do NOT call newSession.
	SM.create = function create(cwd: string): SessionManager {
		const sqliteStore = getOrCreateStore();
		const inst = SM.inMemory(cwd); // constructor calls newSession once (no store yet)
		setSqliteStore(inst, sqliteStore);
		return inst;
	};

	// `open(sessionFile)` — synchronous; sqlite:// URI loads from DB, real
	// .jsonl path imports then loads (for /import command).
	SM.open = function open(sessionFile: string, _sessionDir?: string): SessionManager {
		const sqliteStore = getOrCreateStore();
		let sessionId: string;
		let cwd: string;
		if (isSqliteUri(sessionFile)) {
			sessionId = parseSessionIdFromUri(sessionFile);
			const row = sqliteStore.getSession(sessionId);
			if (!row) throw new Error(`[sqlite-backend] session not found: ${sessionId}`);
			cwd = row.cwd;
		} else {
			// Real .jsonl path — import to DB then load.
			sessionId = importJsonlToDb(sqliteStore, sessionFile);
			const row = sqliteStore.getSession(sessionId);
			if (!row) throw new Error(`[sqlite-backend] imported session not found: ${sessionId}`);
			cwd = row.cwd;
		}
		const inst = SM.inMemory(cwd);
		setSqliteStore(inst, sqliteStore);
		inst.setSessionFile(buildSqliteUri(sessionId));
		return inst;
	};

	// `continueRecent(cwd)` — synchronous.
	SM.continueRecent = function continueRecent(cwd: string): SessionManager {
		const sqliteStore = getOrCreateStore();
		const recent = sqliteStore.findRecent(cwd);
		if (!recent) return SM.create(cwd);
		return SM.open(buildSqliteUri(recent.id));
	};

	// `list(cwd)` / `listAll()` — async (SDK original is async too).
	SM.list = async function list(cwd: string) {
		return getOrCreateStore().listSessions(cwd);
	};
	SM.listAll = async function listAll() {
		return getOrCreateStore().listAllSessions();
	};
}

// ─── Install entry point ────────────────────────────────────

/**
 * Install the SQLite backend. Idempotent. Must be awaited at the top of
 * `createRuntime` before any SessionManager static call.
 */
export async function installSqliteBackend(): Promise<void> {
	if (installed) return;
	installed = true;
	assertSdkStructure(SessionManager);
	store = SessionStore.create();
	await migrateIfNeeded(store);
	patchPrototype(SessionManager.prototype);
	patchStatic(SessionManager);
}

// Re-export for callers (createRuntime) that need the SessionManager type.
export type { SessionManager };
