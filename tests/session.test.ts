import { describe, expect, it } from "bun:test";
import {
	extractAssistantContent,
	extractAssistantText,
	summarizeArgs,
} from "../src/agent/session.js";

describe("extractAssistantContent", () => {
	it("returns string content as text with empty thinking", () => {
		expect(extractAssistantContent("hi")).toEqual({ text: "hi", thinking: "" });
	});

	it("extracts interleaved text and thinking blocks", () => {
		const content = [
			{ type: "thinking", thinking: "let me consider" },
			{ type: "text", text: "answer" },
			{ type: "text", text: " more" },
			{ type: "thinking", thinking: " revised" },
		];
		expect(extractAssistantContent(content)).toEqual({
			text: "answer more",
			thinking: "let me consider revised",
		});
	});

	it("concatenates multiple text blocks", () => {
		expect(
			extractAssistantContent([
				{ type: "text", text: "a" },
				{ type: "text", text: "b" },
			]),
		).toEqual({
			text: "ab",
			thinking: "",
		});
	});

	it("ignores unknown block types", () => {
		expect(
			extractAssistantContent([{ type: "tool_use", id: "x" } as any, { type: "text", text: "ok" }]),
		).toEqual({ text: "ok", thinking: "" });
	});

	it("returns empty on non-string non-array input", () => {
		expect(extractAssistantContent(null)).toEqual({ text: "", thinking: "" });
		expect(extractAssistantContent(undefined)).toEqual({ text: "", thinking: "" });
		expect(extractAssistantContent(42 as any)).toEqual({ text: "", thinking: "" });
		expect(extractAssistantContent({} as any)).toEqual({ text: "", thinking: "" });
	});
});

describe("extractAssistantText", () => {
	it("returns the text part of extractAssistantContent", () => {
		expect(extractAssistantText("hello")).toBe("hello");
		expect(extractAssistantText([{ type: "text", text: "x" }])).toBe("x");
		expect(extractAssistantText(null)).toBe("");
	});
});

describe("summarizeArgs", () => {
	it("keeps values within maxLen unchanged", () => {
		expect(summarizeArgs("short")).toBe("short");
		expect(summarizeArgs({ a: 1 })).toBe(JSON.stringify({ a: 1 }));
	});

	it("truncates overlong strings to exactly maxLen", () => {
		const long = "x".repeat(100);
		const out = summarizeArgs(long, 10);
		expect(out.length).toBe(10);
		expect(out.endsWith("...")).toBe(true);
	});

	it("truncates overlong object JSON the same way", () => {
		const big = { k: "y".repeat(100) };
		const out = summarizeArgs(big, 20);
		expect(out.length).toBe(20);
		expect(out.endsWith("...")).toBe(true);
	});

	it("uses default maxLen of 50", () => {
		expect(summarizeArgs("z".repeat(40)).length).toBe(40);
		expect(summarizeArgs("z".repeat(80)).length).toBe(50);
	});
});
