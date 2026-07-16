import { describe, expect, test } from "bun:test";
import {
	buildBtwCompletionNote,
	buildBtwErrorNote,
	buildBtwSideSessionAwarenessNote,
} from "../src/session/btw.js";

describe("buildBtwSideSessionAwarenessNote", () => {
	test("includes the task summary", () => {
		const note = buildBtwSideSessionAwarenessNote("refactor the auth module");
		expect(note).toContain("refactor the auth module");
	});

	test("marks the side conversation boundaries", () => {
		const note = buildBtwSideSessionAwarenessNote("task");
		expect(note.startsWith("[SIDE CONVERSATION]\n")).toBe(true);
		expect(note.endsWith("[END SIDE CONVERSATION]")).toBe(true);
	});

	test("tells the side agent it shares cwd and tools", () => {
		const note = buildBtwSideSessionAwarenessNote("task");
		expect(note).toContain("same working directory");
	});
});

describe("buildBtwCompletionNote", () => {
	test("wraps summary with completion markers", () => {
		const note = buildBtwCompletionNote("done");
		expect(note).toBe("[BACKGROUND TASK COMPLETED]\ndone\n[END BACKGROUND TASK]");
	});
});

describe("buildBtwErrorNote", () => {
	test("wraps error text with error markers", () => {
		const note = buildBtwErrorNote("boom");
		expect(note).toBe("[BACKGROUND TASK ERROR]\nboom\n[END BACKGROUND TASK]");
	});
});
