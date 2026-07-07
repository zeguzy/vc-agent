import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	buildCoordinatorPrompt,
	type CoordinatorInput,
	collectRecentMessages,
	parseCoordinatorDecision,
} from "../src/teams/coordinator.js";
import type { MemberName, TaskState } from "../src/teams/types-v2.js";

// ─── parseCoordinatorDecision ──────────────────────────────

describe("parseCoordinatorDecision", () => {
	it("parses markdown-wrapped continue decision", () => {
		const raw = [
			"Here is my decision:",
			"```json",
			'{ "action": "continue", "nextSpeaker": "alice", "instruction": "summarize", "reason": "needs synthesis" }',
			"```",
		].join("\n");
		const decision = parseCoordinatorDecision(raw);
		expect(decision.action).toBe("continue");
		if (decision.action !== "continue") return;
		expect(decision.nextSpeaker).toBe("alice");
		expect(decision.instruction).toBe("summarize");
		expect(decision.reason).toBe("needs synthesis");
	});

	it("parses bare JSON continue decision (no code fence)", () => {
		const raw =
			'{ "action": "continue", "nextSpeaker": "bob", "instruction": "ask clarifying question", "reason": "" }';
		const decision = parseCoordinatorDecision(raw);
		expect(decision.action).toBe("continue");
		if (decision.action !== "continue") return;
		expect(decision.nextSpeaker).toBe("bob");
		expect(decision.instruction).toBe("ask clarifying question");
		expect(decision.reason).toBe("");
	});

	it("parses complete decision with reason", () => {
		const raw = '```json\n{ "action": "complete", "reason": "consensus reached" }\n```';
		const decision = parseCoordinatorDecision(raw);
		expect(decision.action).toBe("complete");
		if (decision.action !== "complete") return;
		expect(decision.reason).toBe("consensus reached");
	});

	it("falls back to complete when JSON is malformed (no parseable object)", () => {
		const raw = "I think the discussion is basically done.";
		const decision = parseCoordinatorDecision(raw);
		expect(decision.action).toBe("complete");
		if (decision.action !== "complete") return;
		expect(decision.reason).toMatch(/could not be parsed/i);
	});

	it("falls back to complete when JSON.parse throws", () => {
		const raw = '```json\n{ "action": "continue", invalid json }\n```';
		const decision = parseCoordinatorDecision(raw);
		expect(decision.action).toBe("complete");
		if (decision.action !== "complete") return;
		expect(decision.reason).toMatch(/parse failed|unexpected/i);
	});

	it("falls back to complete when continue decision lacks nextSpeaker", () => {
		const raw = '{ "action": "continue", "instruction": "do something" }';
		const decision = parseCoordinatorDecision(raw);
		expect(decision.action).toBe("complete");
	});

	it("falls back to complete when continue decision lacks instruction", () => {
		const raw = '{ "action": "continue", "nextSpeaker": "alice" }';
		const decision = parseCoordinatorDecision(raw);
		expect(decision.action).toBe("complete");
	});

	it("falls back to complete on unknown action", () => {
		const raw = '{ "action": "wait", "reason": "not supported" }';
		const decision = parseCoordinatorDecision(raw);
		expect(decision.action).toBe("complete");
		if (decision.action !== "complete") return;
		expect(decision.reason).toMatch(/unexpected coordinator action/i);
	});

	it("uses default reason for complete when reason field missing", () => {
		const raw = '{ "action": "complete" }';
		const decision = parseCoordinatorDecision(raw);
		expect(decision.action).toBe("complete");
		if (decision.action !== "complete") return;
		expect(decision.reason).toBe("discussion complete");
	});

	it("uses default empty reason for continue when reason field missing", () => {
		const raw =
			'```json\n{ "action": "continue", "nextSpeaker": "alice", "instruction": "go" }\n```';
		const decision = parseCoordinatorDecision(raw);
		expect(decision.action).toBe("continue");
		if (decision.action !== "continue") return;
		expect(decision.reason).toBe("");
	});
});

// ─── buildCoordinatorPrompt ────────────────────────────────

describe("buildCoordinatorPrompt", () => {
	function makeTask(overrides: Partial<TaskState> = {}): TaskState {
		return {
			id: "T1",
			title: "Pick a launch date",
			description: "Decide when to ship v2.0",
			memberName: "alice",
			priority: "high",
			type: "discussion",
			done: false,
			...overrides,
		};
	}

	it("includes task title, description, and priority", () => {
		const input: CoordinatorInput = {
			task: makeTask(),
			members: [{ name: "alice", role: "pm", status: "idle", currentTaskId: "T1" }],
			recentMessages: [],
			round: 1,
			maxRounds: 10,
		};
		const prompt = buildCoordinatorPrompt(input);
		expect(prompt).toContain("Pick a launch date");
		expect(prompt).toContain("Decide when to ship v2.0");
		expect(prompt).toContain("high");
	});

	it("lists each member with name and role", () => {
		const input: CoordinatorInput = {
			task: makeTask(),
			members: [
				{ name: "alice", role: "pm", status: "idle", currentTaskId: null },
				{ name: "bob", role: "eng", status: "active", currentTaskId: "T1" },
				{ name: "carol", role: "design", status: "idle", currentTaskId: null },
			],
			recentMessages: [],
			round: 2,
			maxRounds: 5,
		};
		const prompt = buildCoordinatorPrompt(input);
		expect(prompt).toContain("alice");
		expect(prompt).toContain("pm");
		expect(prompt).toContain("bob");
		expect(prompt).toContain("eng");
		expect(prompt).toContain("carol");
		expect(prompt).toContain("design");
	});

	it("shows current round and max rounds", () => {
		const input: CoordinatorInput = {
			task: makeTask(),
			members: [{ name: "alice", role: "pm", status: "idle", currentTaskId: null }],
			recentMessages: [],
			round: 3,
			maxRounds: 5,
		};
		const prompt = buildCoordinatorPrompt(input);
		expect(prompt).toContain("Round: 3 / 5");
	});

	it("includes recent messages when present, truncated to 200 chars per content", () => {
		const longContent = "x".repeat(300);
		const input: CoordinatorInput = {
			task: makeTask(),
			members: [{ name: "alice", role: "pm", status: "idle", currentTaskId: null }],
			recentMessages: [
				{
					from: "alice",
					to: "bob",
					content: longContent,
					timestamp: new Date("2026-07-08T10:00:00Z").getTime(),
				},
			],
			round: 1,
			maxRounds: 10,
		};
		const prompt = buildCoordinatorPrompt(input);
		expect(prompt).toContain("alice");
		expect(prompt).toContain("bob");
		// Content truncated to 200 chars per buildCoordinatorPrompt slice
		expect(prompt).toContain("x".repeat(200));
		expect(prompt).not.toContain("x".repeat(201));
	});

	it("shows 'No messages exchanged yet' when no messages", () => {
		const input: CoordinatorInput = {
			task: makeTask(),
			members: [{ name: "alice", role: "pm", status: "idle", currentTaskId: null }],
			recentMessages: [],
			round: 1,
			maxRounds: 10,
		};
		const prompt = buildCoordinatorPrompt(input);
		expect(prompt).toContain("No messages exchanged yet");
	});

	it("includes JSON response format instruction for both actions", () => {
		const input: CoordinatorInput = {
			task: makeTask(),
			members: [{ name: "alice", role: "pm", status: "idle", currentTaskId: null }],
			recentMessages: [],
			round: 1,
			maxRounds: 10,
		};
		const prompt = buildCoordinatorPrompt(input);
		expect(prompt).toContain('"action": "continue"');
		expect(prompt).toContain('"action": "complete"');
	});
});

// ─── collectRecentMessages ─────────────────────────────────

describe("collectRecentMessages", () => {
	let tmpRoot: string;

	beforeAll(() => {
		tmpRoot = mkdtempSync(join(tmpdir(), "coordinator-msgs-"));
	});

	afterAll(() => {
		rmSync(tmpRoot, { recursive: true, force: true });
	});

	function writeInbox(memberName: MemberName, messages: Array<Record<string, unknown>>) {
		const memberDir = join(tmpRoot, memberName);
		mkdirSync(memberDir, { recursive: true });
		const lines = messages.map((m) => JSON.stringify(m)).join("\n");
		writeFileSync(join(memberDir, "inbox.jsonl"), lines + (lines ? "\n" : ""));
	}

	it("merges messages from multiple member inboxes", () => {
		writeInbox("alice", [{ from: "bob", to: "alice", content: "hi alice", timestamp: 1000 }]);
		writeInbox("bob", [{ from: "alice", to: "bob", content: "hi bob", timestamp: 2000 }]);

		const result = collectRecentMessages(tmpRoot, ["alice", "bob"]);
		expect(result.length).toBe(2);
		expect(result.map((m) => m.content).sort()).toEqual(["hi alice", "hi bob"]);
	});

	it("sorts by ascending timestamp", () => {
		writeInbox("alice", [
			{ from: "carol", to: "alice", content: "third", timestamp: 3000 },
			{ from: "bob", to: "alice", content: "first", timestamp: 1000 },
			{ from: "dave", to: "alice", content: "second", timestamp: 2000 },
		]);

		const result = collectRecentMessages(tmpRoot, ["alice"]);
		expect(result.map((m) => m.content)).toEqual(["first", "second", "third"]);
	});

	it("deduplicates messages with same from + to + timestamp", () => {
		// Same message appears in both alice's and bob's inbox (sender + receiver copies)
		writeInbox("alice", [{ from: "bob", to: "alice", content: "dup", timestamp: 5000 }]);
		writeInbox("bob", [{ from: "bob", to: "alice", content: "dup", timestamp: 5000 }]);

		const result = collectRecentMessages(tmpRoot, ["alice", "bob"]);
		const dupCount = result.filter(
			(m) => m.from === "bob" && m.to === "alice" && m.timestamp === 5000,
		).length;
		expect(dupCount).toBe(1);
	});

	it("truncates to limit (default 30)", () => {
		const many = Array.from({ length: 50 }, (_, i) => ({
			from: "bob",
			to: "alice",
			content: `msg-${i}`,
			timestamp: 10000 + i,
		}));
		writeInbox("alice", many);

		const result = collectRecentMessages(tmpRoot, ["alice"]);
		expect(result.length).toBe(30);
		// Should keep the LAST 30 (newest) after sort
		expect(result[result.length - 1].content).toBe("msg-49");
		expect(result[0].content).toBe("msg-20");
	});

	it("respects custom limit argument", () => {
		const result = collectRecentMessages(tmpRoot, ["alice"], 5);
		expect(result.length).toBeLessThanOrEqual(5);
	});

	it("returns empty array when member inbox file does not exist", () => {
		const result = collectRecentMessages(tmpRoot, ["nonexistent-member"]);
		expect(result).toEqual([]);
	});

	it("skips malformed JSON lines without throwing", () => {
		const memberDir = join(tmpRoot, "malformed");
		mkdirSync(memberDir, { recursive: true });
		writeFileSync(
			join(memberDir, "inbox.jsonl"),
			'{ "from": "ok", "to": "malformed", "content": "good", "timestamp": 1 }\n{ invalid json }\n',
		);

		const result = collectRecentMessages(tmpRoot, ["malformed"]);
		expect(result.length).toBe(1);
		expect(result[0].content).toBe("good");
	});

	it("normalizes 'to' field: broadcast stays as broadcast", () => {
		writeInbox("alice", [
			{ from: "carol", to: "broadcast", content: "team announcement", timestamp: 100 },
		]);

		const result = collectRecentMessages(tmpRoot, ["alice"]);
		expect(result.length).toBeGreaterThan(0);
		const broadcast = result.find((m) => m.content === "team announcement");
		expect(broadcast).toBeDefined();
		expect(broadcast?.to).toBe("broadcast");
	});

	it("handles missing directory gracefully (existsSync false)", () => {
		const missingDir = join(tmpdir(), "does-not-exist-" + Date.now());
		expect(existsSync(missingDir)).toBe(false);
		const result = collectRecentMessages(missingDir, ["anyone"]);
		expect(result).toEqual([]);
	});
});
