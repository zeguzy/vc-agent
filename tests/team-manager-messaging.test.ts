import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { TeamManager } from "../src/teams/manager-v2.js";
import { MemberInbox } from "../src/teams/messages.js";
import { DEFAULT_TEAM_CONFIG, resolveTeamConfig } from "../src/teams/types.js";
import type { TeamEvent } from "../src/teams/types-v2.js";

function fakeSession(streaming = true): AgentSession {
	return {
		isStreaming: streaming,
		messages: [],
		steer() {
			return new Promise(() => {});
		},
		prompt() {
			return new Promise(() => {});
		},
	} as unknown as AgentSession;
}

function fakeSessionResolving(): AgentSession {
	return {
		isStreaming: true,
		messages: [],
		steer() {
			return Promise.resolve();
		},
		prompt() {
			return Promise.resolve();
		},
	} as unknown as AgentSession;
}

interface TestRig {
	manager: TeamManager;
	events: TeamEvent[];
	tmpDir: string;
	inject(name: string, status?: "active" | "idle", resolving?: boolean): void;
}

function makeRig(): TestRig {
	const tmpDir = mkdtempSync(join(tmpdir(), "tm-msg-"));
	const config = resolveTeamConfig({
		...DEFAULT_TEAM_CONFIG,
		messageHistoryLimit: 50,
		messageRateLimitPerMinute: 5,
	});
	const manager = new TeamManager(config, {} as never, tmpDir, join(tmpDir, "team"));
	const events: TeamEvent[] = [];
	const inject = (name: string, status: "active" | "idle" = "active", resolving = true): void => {
		// @ts-expect-error: test fixture reaches into private state
		manager.members.set(name, {
			name,
			role: "tester",
			goal: "g",
			status,
			session: resolving ? fakeSessionResolving() : fakeSession(),
			currentTaskId: null,
			lastTaskPrompt: null,
		});
		// @ts-expect-error
		manager.inboxes.set(
			name,
			// @ts-expect-error
			new MemberInbox(manager.files.paths.memberTopics(name), 50),
		);
	};
	// @ts-expect-error: subscribe to events
	manager.listeners.add((e: TeamEvent) => events.push(e));
	return { manager, events, tmpDir, inject };
}

describe("TeamManager messaging", () => {
	const rigs: TestRig[] = [];

	afterEach(() => {
		while (rigs.length > 0) {
			const r = rigs.pop();
			if (r) rmSync(r.tmpDir, { recursive: true, force: true });
		}
	});

	function rig(): TestRig {
		const r = makeRig();
		rigs.push(r);
		return r;
	}

	it("sendMessage persists + emits event when active", () => {
		const { manager, events, inject } = rig();
		inject("alice", "active");
		inject("bob", "active");
		const result = manager.sendMessage({ from: "bob", to: "alice", content: "hi" });
		expect(result.delivery).toBe("steer");
		expect(result.message.from).toBe("bob");
		expect(events.some((e) => e.type === "member_message_sent")).toBe(true);
	});

	it("sendMessage delivers persist-only when recipient is idle", () => {
		const { manager, inject } = rig();
		inject("carol", "idle");
		inject("dave", "active");
		const result = manager.sendMessage({ from: "dave", to: "carol", content: "ping" });
		expect(result.delivery).toBe("persist-only");
	});

	it("sendMessage rejects self-send", () => {
		const { manager, inject } = rig();
		inject("eve", "active");
		expect(() => manager.sendMessage({ from: "eve", to: "eve", content: "x" })).toThrow(/yourself/);
	});

	it("sendMessage rejects unknown recipient", () => {
		const { manager, inject } = rig();
		inject("frank", "active");
		expect(() => manager.sendMessage({ from: "frank", to: "ghost", content: "x" })).toThrow(
			/not found/,
		);
	});

	it("sendMessage rejects empty content", () => {
		const { manager, inject } = rig();
		inject("grace", "active");
		inject("heidi", "active");
		expect(() => manager.sendMessage({ from: "grace", to: "heidi", content: "   " })).toThrow(
			/content is required/,
		);
	});

	it("pair cooldown prevents A↔B ping-pong beyond PAIR_MAX_EXCHANGES (4)", () => {
		const { manager, inject } = rig();
		inject("kim", "active");
		inject("leo", "active");
		manager.sendMessage({ from: "kim", to: "leo", content: "1" });
		manager.sendMessage({ from: "leo", to: "kim", content: "2" });
		manager.sendMessage({ from: "kim", to: "leo", content: "3" });
		manager.sendMessage({ from: "leo", to: "kim", content: "4" });
		expect(() => manager.sendMessage({ from: "kim", to: "leo", content: "5" })).toThrow(
			/pair cooldown/,
		);
	});

	it("rate limit triggers after messageRateLimitPerMinute sends", () => {
		const { manager, inject } = rig();
		inject("ivan", "active");
		for (let i = 0; i < 5; i++) inject(`r${i}`, "active");
		const recipients = ["r0", "r1", "r2", "r3", "r4"];
		for (let i = 0; i < 5; i++) {
			manager.sendMessage({ from: "ivan", to: recipients[i], content: `m${i}` });
		}
		expect(() =>
			manager.sendMessage({ from: "ivan", to: recipients[0], content: "should fail" }),
		).toThrow(/rate limit/);
	});

	it("broadcastMessage respects per-window limit (2)", () => {
		const { manager, inject } = rig();
		inject("mallory", "active");
		inject("nina", "active");
		inject("oscar", "active");
		const r1 = manager.broadcastMessage({ from: "mallory", content: "first" });
		expect(r1.length).toBeGreaterThan(0);
		const r2 = manager.broadcastMessage({ from: "mallory", content: "second" });
		expect(r2.length).toBeGreaterThan(0);
		expect(() => manager.broadcastMessage({ from: "mallory", content: "third" })).toThrow(
			/broadcast rate limit/,
		);
	});

	it("broadcastMessage skips sender", () => {
		const { manager, inject } = rig();
		inject("pat", "active");
		inject("quinn", "active");
		inject("riley", "active");
		const results = manager.broadcastMessage({ from: "pat", content: "team" });
		expect(results.length).toBe(2);
		const inboxQuinn = manager.readInbox("quinn");
		const inboxRiley = manager.readInbox("riley");
		const inboxPat = manager.readInbox("pat");
		expect(inboxQuinn.length).toBe(1);
		expect(inboxRiley.length).toBe(1);
		expect(inboxPat.length).toBe(0);
	});

	it("readInbox returns persisted messages with filters", () => {
		const { manager, inject } = rig();
		inject("alice", "active");
		inject("bob", "active");
		manager.sendMessage({ from: "bob", to: "alice", content: "hi-1" });
		manager.sendMessage({ from: "bob", to: "alice", content: "hi-2" });
		const all = manager.readInbox("alice");
		expect(all.length).toBe(2);
		const filtered = manager.readInbox("alice", { from: "carol" });
		expect(filtered.length).toBe(0);
		manager.markInboxRead("alice", [all[0].id]);
		const unread = manager.readInbox("alice", { unreadOnly: true });
		expect(unread.length).toBe(1);
		expect(unread[0].content).toBe("hi-2");
	});

	it("in-flight steer cap degrades to persist-only after MAX_IN_FLIGHT_STEER (3)", () => {
		const { manager, inject } = rig();
		inject("sink", "active", false);
		for (const s of ["a1", "a2", "a3", "a4", "a5", "a6"]) inject(s, "active");

		const senders = ["a1", "a2", "a3", "a4", "a5", "a6"];
		const results = senders.map((s) =>
			manager.sendMessage({ from: s, to: "sink", content: `from-${s}` }),
		);
		const steerCount = results.filter((r) => r.delivery === "steer").length;
		const persistCount = results.filter((r) => r.delivery === "persist-only").length;
		expect(steerCount).toBe(5);
		expect(persistCount).toBe(1);
	});

	it("readInbox on member without inbox throws", () => {
		const { manager } = rig();
		expect(() => manager.readInbox("nobody")).toThrow(/inbox for "nobody" not found/);
	});
});
