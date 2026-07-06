import { describe, expect, test } from "bun:test";
import {
	computeMaxWidth,
	effectiveColumns,
	truncateToWidth,
} from "../src/tui/components/TeamTopology.js";

describe("effectiveColumns", () => {
	test("returns the input when positive", () => {
		expect(effectiveColumns(120)).toBe(120);
	});
	test("falls back to 80 when undefined", () => {
		expect(effectiveColumns(undefined)).toBe(80);
	});
	test("falls back to 80 when null", () => {
		expect(effectiveColumns(null)).toBe(80);
	});
	test("falls back to 80 when 0 (PTY init phase)", () => {
		expect(effectiveColumns(0)).toBe(80);
	});
	test("falls back to 80 when negative", () => {
		expect(effectiveColumns(-1)).toBe(80);
	});
});

describe("computeMaxWidth", () => {
	test("subtracts padding(2+2) and treeIndent(4) from column count", () => {
		expect(computeMaxWidth(100)).toBe(92);
	});
	test("uses fallback 80 when columns undefined", () => {
		expect(computeMaxWidth(undefined)).toBe(72);
	});
	test("uses fallback 80 when columns is 0", () => {
		expect(computeMaxWidth(0)).toBe(72);
	});
});

describe("truncateToWidth", () => {
	test("returns the text unchanged when within width", () => {
		expect(truncateToWidth("hello", 10)).toBe("hello");
	});
	test("returns the text unchanged when exactly at width", () => {
		expect(truncateToWidth("hello", 5)).toBe("hello");
	});
	test("truncates and appends ellipsis when exceeding width", () => {
		expect(truncateToWidth("hello world", 8)).toBe("hello w…");
	});
	test("returns empty string when maxWidth is 0", () => {
		expect(truncateToWidth("hello", 0)).toBe("");
	});
	test("returns just ellipsis when maxWidth is 1", () => {
		expect(truncateToWidth("hello", 1)).toBe("…");
	});
	test("handles multi-byte (CJK) characters by codepoint count", () => {
		expect(truncateToWidth("你好世界朋友", 4)).toBe("你好世…");
	});
	test("preserves multi-byte chars within width", () => {
		expect(truncateToWidth("你好", 5)).toBe("你好");
	});
});
