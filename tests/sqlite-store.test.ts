import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FileEntry, SessionHeader } from "@earendil-works/pi-coding-agent";
import { SessionStore } from "../src/session/sqlite-store";

function makeHeader(id: string, cwd = "/test"): SessionHeader {
	return {
		type: "session",
		version: 2,
		id,
		timestamp: new Date().toISOString(),
		cwd,
	};
}

function makeMessage(
	id: string,
	parentId: string | null,
	role: "user" | "assistant",
	text: string,
): FileEntry {
	return {
		type: "message",
		id,
		parentId,
		timestamp: new Date().toISOString(),
		message: { role, content: [{ type: "text", text }] },
	} as unknown as FileEntry;
}

describe("SessionStore", () => {
	let store: SessionStore;
	let dbPath: string;

	beforeEach(() => {
		dbPath = join(tmpdir(), `test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
		store = SessionStore.openAt(dbPath);
	});

	afterEach(() => {
		store.close();
	});

	it("createSession + hasSession", () => {
		expect(store.hasSession("s1")).toBe(false);
		store.createSession("s1", "/test");
		expect(store.hasSession("s1")).toBe(true);
		const row = store.getSession("s1");
		expect(row?.cwd).toBe("/test");
	});

	it("createSession is idempotent (INSERT OR IGNORE)", () => {
		store.createSession("s1", "/test");
		store.createSession("s1", "/other"); // should not throw, not overwrite
		expect(store.getSession("s1")?.cwd).toBe("/test");
	});

	it("insertEntry + loadEntries preserves sort_order", () => {
		store.createSession("s1", "/test");
		const header = makeHeader("s1");
		const msg1 = makeMessage("m1", "s1", "user", "hello");
		const msg2 = makeMessage("m2", "m1", "assistant", "hi");
		store.insertEntry("s1", 0, header);
		store.insertEntry("s1", 1, msg1);
		store.insertEntry("s1", 2, msg2);
		const entries = store.loadEntries("s1");
		expect(entries).toHaveLength(3);
		expect(entries[0]).toEqual(header);
		expect(entries[1]).toEqual(msg1);
		expect(entries[2]).toEqual(msg2);
	});

	it("rewriteAll replaces all entries transactionally", () => {
		store.createSession("s1", "/test");
		store.insertEntry("s1", 0, makeHeader("s1"));
		store.insertEntry("s1", 1, makeMessage("m1", "s1", "user", "old"));
		// compaction: replace with fewer entries
		const compacted = [makeHeader("s1"), makeMessage("m2", "s1", "assistant", "summary")];
		store.rewriteAll("s1", compacted);
		const entries = store.loadEntries("s1");
		expect(entries).toHaveLength(2);
		expect((entries[1] as { message: { content: { text: string }[] }[] }).message).toEqual(
			compacted[1].message,
		);
	});

	it("count + findRecent", () => {
		expect(store.count()).toBe(0);
		store.createSession("s1", "/proj");
		store.createSession("s2", "/proj");
		store.createSession("s3", "/other");
		expect(store.count()).toBe(3);
		const recent = store.findRecent("/proj");
		expect(recent).toBeDefined();
		expect(["s1", "s2"]).toContain(recent?.id);
	});

	it("listSessions filters by cwd", () => {
		store.createSession("s1", "/proj");
		store.createSession("s2", "/proj");
		store.createSession("s3", "/other");
		const projSessions = store.listSessions("/proj");
		expect(projSessions).toHaveLength(2);
		expect(projSessions.every((s) => s.cwd === "/proj")).toBe(true);
	});

	it("bulkImport in single transaction", () => {
		const sessions = [
			{
				sessionId: "b1",
				cwd: "/proj",
				createdAt: new Date().toISOString(),
				entries: [makeHeader("b1"), makeMessage("m1", "b1", "user", "hi")],
			},
			{
				sessionId: "b2",
				cwd: "/proj",
				createdAt: new Date().toISOString(),
				entries: [makeHeader("b2"), makeMessage("m2", "b2", "assistant", "hello")],
			},
		];
		store.bulkImport(sessions);
		expect(store.count()).toBe(2);
		expect(store.loadEntries("b1")).toHaveLength(2);
		expect(store.loadEntries("b2")).toHaveLength(2);
	});

	it("setSessionName updates name", () => {
		store.createSession("s1", "/test");
		store.setSessionName("s1", "my session");
		expect(store.getSession("s1")?.name).toBe("my session");
	});
});
