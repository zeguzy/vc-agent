import { describe, expect, it } from "bun:test";
import {
	createAssistantMessage,
	createSeparator,
	createToolMessage,
	createUserMessage,
	nextId,
} from "../src/message.js";

describe("nextId", () => {
	it("produces msg-<number> ids", () => {
		const id = nextId();
		expect(id).toMatch(/^msg-\d+$/);
	});

	it("is monotonically increasing within a session", () => {
		const a = nextId();
		const b = nextId();
		const c = nextId();
		expect(Number.parseInt(b.slice(4), 10)).toBeGreaterThan(Number.parseInt(a.slice(4), 10));
		expect(Number.parseInt(c.slice(4), 10)).toBeGreaterThan(Number.parseInt(b.slice(4), 10));
	});
});

describe("message factories", () => {
	it("createUserMessage sets role=user and content", () => {
		const m = createUserMessage("hello");
		expect(m.role).toBe("user");
		expect(m.content).toBe("hello");
		expect(m.id).toMatch(/^msg-\d+$/);
	});

	it("createAssistantMessage defaults to empty content", () => {
		expect(createAssistantMessage().content).toBe("");
		expect(createAssistantMessage("hi").content).toBe("hi");
	});

	it("createToolMessage sets running status by default", () => {
		const m = createToolMessage("read", { path: "/x" });
		expect(m.role).toBe("tool");
		expect(m.toolName).toBe("read");
		expect(m.toolStatus).toBe("running");
		expect(m.toolArgs).toEqual({ path: "/x" });
	});

	it("createToolMessage accepts explicit status", () => {
		expect(createToolMessage("bash", {}, "error").toolStatus).toBe("error");
		expect(createToolMessage("bash", {}, "done").toolStatus).toBe("done");
	});

	it("createSeparator sets role=separator", () => {
		const m = createSeparator();
		expect(m.role).toBe("separator");
		expect(m.content).toBe("");
	});
});
