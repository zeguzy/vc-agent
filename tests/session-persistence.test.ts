import { describe, expect, it } from "bun:test";
import { formatSessionList, resolveSessionRef, type SessionInfo } from "../src/session/list.js";
import { mapSdkMessagesToTui } from "../src/session/render.js";
import { sessionDirRoot } from "../src/session/storage.js";

function makeInfo(partial: Partial<SessionInfo> = {}): SessionInfo {
	return {
		path: "/p",
		id: "id",
		cwd: "/c",
		created: new Date(),
		modified: new Date(),
		messageCount: 0,
		firstMessage: "",
		allMessagesText: "",
		...partial,
	};
}

describe("sessionDirRoot", () => {
	it("joins home/.config/openagent/sessions", () => {
		expect(sessionDirRoot("/home/x")).toBe("/home/x/.config/openagent/sessions");
	});

	it("is pure (does not touch filesystem)", () => {
		expect(sessionDirRoot("/tmp")).toBe("/tmp/.config/openagent/sessions");
	});
});

describe("formatSessionList", () => {
	it("empty list returns placeholder", () => {
		expect(formatSessionList([])).toContain("暂无会话");
	});

	it("groups today and shows index/preview/count", () => {
		const now = new Date("2026-06-27T12:00:00Z");
		const s = makeInfo({
			id: "a",
			firstMessage: "hello world",
			messageCount: 3,
			modified: now,
		});
		const out = formatSessionList([s], undefined, now);
		expect(out).toContain("Today");
		expect(out).toContain("hello world");
		expect(out).toContain("1.");
		expect(out).toContain("3 msgs");
	});

	it("prefers name over firstMessage", () => {
		const now = new Date();
		const s = makeInfo({ name: "my task", firstMessage: "hidden", modified: now });
		expect(formatSessionList([s], undefined, now)).toContain("my task");
	});

	it("marks the current session", () => {
		const now = new Date();
		const s = makeInfo({ id: "cur", firstMessage: "x", modified: now });
		expect(formatSessionList([s], "cur", now)).toContain("▸");
	});

	it("does not mark non-current sessions", () => {
		const now = new Date();
		const s = makeInfo({ id: "other", firstMessage: "x", modified: now });
		expect(formatSessionList([s], "cur", now)).not.toContain("▸");
	});

	it("sorts most-recent-first", () => {
		const old = makeInfo({ id: "old", firstMessage: "old", modified: new Date("2026-01-01") });
		const recent = makeInfo({ id: "new", firstMessage: "new", modified: new Date("2026-06-27") });
		const out = formatSessionList([old, recent]);
		const newIdx = out.indexOf("new");
		const oldIdx = out.indexOf("old");
		expect(newIdx).toBeGreaterThan(-1);
		expect(oldIdx).toBeGreaterThan(-1);
		expect(newIdx).toBeLessThan(oldIdx);
	});
});

describe("resolveSessionRef", () => {
	const sessions = [
		makeInfo({ path: "/p1", id: "abc123" }),
		makeInfo({ path: "/p2", id: "def456" }),
	];

	it("numeric resolves by 1-based index", () => {
		expect(resolveSessionRef(sessions, "1")).toBe("/p1");
		expect(resolveSessionRef(sessions, "2")).toBe("/p2");
	});

	it("out-of-range numeric returns undefined", () => {
		expect(resolveSessionRef(sessions, "9")).toBeUndefined();
	});

	it("exact id match", () => {
		expect(resolveSessionRef(sessions, "abc123")).toBe("/p1");
	});

	it("id prefix match", () => {
		expect(resolveSessionRef(sessions, "def")).toBe("/p2");
	});

	it("no match returns undefined", () => {
		expect(resolveSessionRef(sessions, "zzz")).toBeUndefined();
	});

	it("empty ref returns undefined", () => {
		expect(resolveSessionRef(sessions, "")).toBeUndefined();
		expect(resolveSessionRef(sessions, "  ")).toBeUndefined();
	});
});

describe("mapSdkMessagesToTui", () => {
	it("non-array input returns empty", () => {
		expect(mapSdkMessagesToTui(null)).toEqual([]);
		expect(mapSdkMessagesToTui(undefined)).toEqual([]);
		expect(mapSdkMessagesToTui("nope")).toEqual([]);
	});

	it("maps a user message", () => {
		const out = mapSdkMessagesToTui([{ role: "user", content: "hi" }]);
		expect(out).toHaveLength(1);
		expect(out[0].role).toBe("user");
		expect(out[0].content).toBe("hi");
	});

	it("maps assistant text + thinking + tool_use", () => {
		const out = mapSdkMessagesToTui([
			{
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "deliberating" },
					{ type: "text", text: "answer" },
					{ type: "tool_use", name: "read", input: { path: "/x" } },
				],
			},
		]);
		expect(out).toHaveLength(2);
		expect(out[0].role).toBe("assistant");
		expect(out[0].content).toBe("answer");
		expect(out[0].thinking).toBe("deliberating");
		expect(out[1].role).toBe("tool");
		expect(out[1].toolName).toBe("read");
		expect(out[1].toolStatus).toBe("done");
	});

	it("inserts separator before a user turn that follows an assistant turn", () => {
		const out = mapSdkMessagesToTui([
			{ role: "user", content: "q1" },
			{ role: "assistant", content: "a1" },
			{ role: "user", content: "q2" },
		]);
		expect(out.map((m) => m.role)).toEqual(["user", "assistant", "separator", "user"]);
		expect(out[3].content).toBe("q2");
	});

	it("does not insert a leading separator", () => {
		const out = mapSdkMessagesToTui([{ role: "user", content: "first" }]);
		expect(out[0].role).toBe("user");
	});

	it("ignores unknown roles", () => {
		const out = mapSdkMessagesToTui([
			{ role: "system", content: "sys" },
			{ role: "user", content: "hi" },
		]);
		expect(out).toHaveLength(1);
		expect(out[0].role).toBe("user");
	});

	it("degrades gracefully on malformed content", () => {
		const out = mapSdkMessagesToTui([{ role: "user", content: 42 }]);
		expect(out).toEqual([]);
	});
});
