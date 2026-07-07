import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateMessageId, MemberInbox } from "../src/teams/messages.js";
import type { MemberMessage } from "../src/teams/types-v2.js";

function makeMessage(from: string, to: string, content = "hello"): MemberMessage {
	return {
		id: generateMessageId(),
		from,
		to,
		content,
		timestamp: Date.now(),
		read: false,
	};
}

describe("MemberInbox", () => {
	let tmpDir: string;
	let topicsDir: string;

	beforeAll(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "msg-test-"));
		topicsDir = join(tmpDir, "alice");
	});

	afterAll(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("append writes to inbox.jsonl and read returns messages", () => {
		const inbox = new MemberInbox(topicsDir, 100);
		const msg = makeMessage("bob", "alice", "hi alice");
		inbox.append(msg);
		const all = inbox.read();
		expect(all.length).toBe(1);
		expect(all[0].content).toBe("hi alice");
		expect(all[0].from).toBe("bob");
		expect(existsSync(join(topicsDir, "inbox.jsonl"))).toBe(true);
	});

	it("respects historyLimit by trimming oldest", () => {
		const smallDir = join(tmpDir, "trim-test");
		const inbox = new MemberInbox(smallDir, 3);
		for (let i = 0; i < 5; i++) {
			inbox.append(makeMessage("bob", "alice", `msg-${i}`));
		}
		const all = inbox.read();
		expect(all.length).toBe(3);
		expect(all[0].content).toBe("msg-2");
		expect(all[2].content).toBe("msg-4");
	});

	it("filters by from", () => {
		const inbox = new MemberInbox(join(tmpDir, "filter-from"), 100);
		inbox.append(makeMessage("bob", "alice", "from bob"));
		inbox.append(makeMessage("carol", "alice", "from carol"));
		const fromBob = inbox.read({ from: "bob" });
		expect(fromBob.length).toBe(1);
		expect(fromBob[0].from).toBe("bob");
	});

	it("filters unread only", () => {
		const inbox = new MemberInbox(join(tmpDir, "unread"), 100);
		const m1 = makeMessage("bob", "alice", "first");
		const m2 = makeMessage("bob", "alice", "second");
		inbox.append(m1);
		inbox.append(m2);
		inbox.markRead([m1.id]);
		const unread = inbox.read({ unreadOnly: true });
		expect(unread.length).toBe(1);
		expect(unread[0].id).toBe(m2.id);
	});

	it("respects limit option", () => {
		const inbox = new MemberInbox(join(tmpDir, "limit"), 100);
		for (let i = 0; i < 10; i++) {
			inbox.append(makeMessage("bob", "alice", `m-${i}`));
		}
		const last3 = inbox.read({ limit: 3 });
		expect(last3.length).toBe(3);
		expect(last3[0].content).toBe("m-7");
		expect(last3[2].content).toBe("m-9");
	});

	it("markRead all when no ids given", () => {
		const inbox = new MemberInbox(join(tmpDir, "mark-all"), 100);
		inbox.append(makeMessage("bob", "alice", "a"));
		inbox.append(makeMessage("bob", "alice", "b"));
		const count = inbox.markRead();
		expect(count).toBe(2);
		const all = inbox.read();
		expect(all.every((m) => m.read)).toBe(true);
	});

	it("markRead persists to disk via atomic rewrite", async () => {
		const dir = join(tmpDir, "atomic");
		const inbox = new MemberInbox(dir, 100);
		const m1 = makeMessage("bob", "alice", "atomic-test");
		inbox.append(m1);
		inbox.markRead([m1.id]);
		// Wait for the chain
		await new Promise((r) => setTimeout(r, 50));
		const raw = readFileSync(join(dir, "inbox.jsonl"), "utf-8");
		const parsed = JSON.parse(raw.trim()) as MemberMessage;
		expect(parsed.read).toBe(true);
	});

	it("markRead returns 0 when nothing to mark", () => {
		const inbox = new MemberInbox(join(tmpDir, "no-op"), 100);
		const m1 = makeMessage("bob", "alice", "x");
		inbox.append(m1);
		inbox.markRead([m1.id]);
		const count = inbox.markRead([m1.id]); // already read
		expect(count).toBe(0);
	});

	it("read on non-existent inbox returns empty", () => {
		const inbox = new MemberInbox(join(tmpDir, "never-existed"), 100);
		expect(inbox.read()).toEqual([]);
	});

	it("generateMessageId produces msg_ prefix with unique ids", () => {
		const ids = new Set<string>();
		for (let i = 0; i < 100; i++) {
			ids.add(generateMessageId());
		}
		expect(ids.size).toBe(100);
		for (const id of ids) {
			expect(id.startsWith("msg_")).toBe(true);
			expect(id.length).toBe(12); // msg_ + 8 chars
		}
	});
});
