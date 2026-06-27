import { describe, expect, test } from "bun:test";
import { formatDiagnostics, formatLocations } from "../src/lsp/lspClient.js";

describe("formatDiagnostics", () => {
	test("empty list returns placeholder", () => {
		expect(formatDiagnostics([])).toBe("No diagnostics found");
	});

	test("formats single error", () => {
		const diag = {
			range: { start: { line: 14, character: 9 }, end: { line: 14, character: 20 } },
			severity: 1 as const,
			message: "Cannot find name 'processData'",
		};
		const result = formatDiagnostics([diag]);
		expect(result).toBe("error [15:9]: Cannot find name 'processData'");
	});

	test("formats multiple severities", () => {
		const diags = [
			{
				range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
				severity: 1 as const,
				message: "E1",
			},
			{
				range: { start: { line: 1, character: 3 }, end: { line: 1, character: 8 } },
				severity: 2 as const,
				message: "W1",
			},
			{
				range: { start: { line: 2, character: 6 }, end: { line: 2, character: 10 } },
				severity: 3 as const,
				message: "I1",
			},
		];
		const result = formatDiagnostics(diags);
		expect(result).toBe("error [1:0]: E1\nwarning [2:3]: W1\ninformation [3:6]: I1");
	});

	test("filters by severity", () => {
		const diags = [
			{
				range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
				severity: 1 as const,
				message: "error",
			},
			{
				range: { start: { line: 1, character: 0 }, end: { line: 1, character: 1 } },
				severity: 2 as const,
				message: "warning",
			},
		];
		expect(formatDiagnostics(diags, "error")).toBe("error [1:0]: error");
		expect(formatDiagnostics(diags, "warning")).toBe("warning [2:0]: warning");
		expect(formatDiagnostics(diags, "all")).toBe("error [1:0]: error\nwarning [2:0]: warning");
	});

	test("caps at maxItems", () => {
		const diags = Array.from({ length: 60 }, (_, i) => ({
			range: { start: { line: i, character: 0 }, end: { line: i, character: 1 } },
			severity: 3 as const,
			message: `msg${i}`,
		}));
		const result = formatDiagnostics(diags, undefined, 50);
		expect(result).toContain("showing first 50");
	});
});

describe("formatLocations", () => {
	test("empty list returns empty string", () => {
		expect(formatLocations([])).toBe("");
	});

	test("formats single location", () => {
		const loc = {
			uri: "file:///project/src/index.ts",
			range: { start: { line: 41, character: 4 }, end: { line: 41, character: 10 } },
		};
		expect(formatLocations([loc])).toBe("/project/src/index.ts:42:4");
	});

	test("formats multiple locations", () => {
		const locs = [
			{
				uri: "file:///a.ts",
				range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
			},
			{
				uri: "file:///b.ts",
				range: { start: { line: 4, character: 8 }, end: { line: 4, character: 9 } },
			},
		];
		expect(formatLocations(locs)).toBe("/a.ts:1:0\n/b.ts:5:8");
	});

	test("caps at maxItems", () => {
		const locs = Array.from({ length: 110 }, (_, i) => ({
			uri: `file:///${i}.ts`,
			range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
		}));
		const result = formatLocations(locs);
		expect(result).toContain("showing first 100");
	});
});
