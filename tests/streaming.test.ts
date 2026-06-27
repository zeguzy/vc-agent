import { describe, expect, test } from "bun:test";
import { splitStreamingText } from "../src/tui/utils/streaming.js";

describe("splitStreamingText", () => {
	test("plain text returns as head with no tail", () => {
		expect(splitStreamingText("hello world")).toEqual({ head: "hello world" });
	});

	test("completed code block returns as head", () => {
		const text = "Intro\n\n```ts\nconst x = 1\n```\n\nDone";
		expect(splitStreamingText(text)).toEqual({ head: text });
	});

	test("unclosed fence splits head and tail", () => {
		const result = splitStreamingText("Intro\n\n```python\nprint('hi')");
		expect(result.head).toBe("Intro\n\n");
		expect(result.tail).toBe("```python\nprint('hi')");
	});

	test("head is empty when content starts with fence", () => {
		const result = splitStreamingText("```bash\necho hi");
		expect(result.head).toBe("");
		expect(result.tail).toBe("```bash\necho hi");
	});

	test("nested fence — only outermost matters", () => {
		const text = "```\nouter\n```inner\nstill outer";
		const result = splitStreamingText(text);
		expect(result.tail).toBe(text);
	});

	test("tilde fences are supported", () => {
		const result = splitStreamingText("before\n~~~\nafter");
		expect(result.head).toBe("before\n");
		expect(result.tail).toBe("~~~\nafter");
	});
});
