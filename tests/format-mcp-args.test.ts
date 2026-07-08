import { describe, expect, it } from "bun:test";
import { formatMcpArgs } from "../src/tui/components/MessageList.js";

describe("formatMcpArgs", () => {
	it("builds label from server_name and tool_name", () => {
		const result = formatMcpArgs({
			server_name: "github",
			tool_name: "create_issue",
			arguments: {},
		});
		expect(result.label).toBe("github · create_issue");
		expect(result.lines).toEqual([]);
	});

	it("extracts primitive kv pairs from arguments", () => {
		const result = formatMcpArgs({
			server_name: "fs",
			tool_name: "read",
			arguments: { path: "/src/index.ts", line: 42, encoding: "utf-8" },
		});
		expect(result.label).toBe("fs · read");
		expect(result.lines).toContain("path: /src/index.ts");
		expect(result.lines).toContain("line: 42");
		expect(result.lines).toContain("encoding: utf-8");
	});

	it("filters sensitive keys", () => {
		const result = formatMcpArgs({
			server_name: "api",
			tool_name: "request",
			arguments: {
				url: "https://example.com",
				api_key: "secret123",
				token: "bearer xyz",
				password: "hunter2",
				auth: "Basic abc",
				normal: "visible",
			},
		});
		expect(result.lines).toContain("url: https://example.com");
		expect(result.lines).toContain("normal: visible");
		expect(result.lines).not.toContain("api_key: secret123");
		expect(result.lines).not.toContain("token: bearer xyz");
		expect(result.lines).not.toContain("password: hunter2");
		expect(result.lines).not.toContain("auth: Basic abc");
	});

	it("skips non-primitive values", () => {
		const result = formatMcpArgs({
			server_name: "db",
			tool_name: "query",
			arguments: {
				sql: "SELECT 1",
				options: { nested: true },
				results: [1, 2, 3],
			},
		});
		expect(result.lines).toContain("sql: SELECT 1");
		expect(result.lines).not.toContain(expect.stringContaining("options"));
		expect(result.lines).not.toContain(expect.stringContaining("results"));
	});

	it("truncates long values to 50 chars", () => {
		const longVal = "x".repeat(100);
		const result = formatMcpArgs({
			server_name: "s",
			tool_name: "t",
			arguments: { data: longVal },
		});
		const dataLine = result.lines.find((l) => l.startsWith("data:"));
		expect(dataLine).toBeDefined();
		expect(dataLine!.length).toBeLessThan(longVal.length + 6);
		expect(dataLine!.endsWith("...")).toBe(true);
	});

	it("falls back to mcp label when no server/tool", () => {
		const result = formatMcpArgs({ arguments: {} });
		expect(result.label).toBe("mcp");
	});

	it("handles missing arguments field", () => {
		const result = formatMcpArgs({ server_name: "s", tool_name: "t" });
		expect(result.label).toBe("s · t");
		expect(result.lines).toEqual([]);
	});

	it("handles arguments being a non-object", () => {
		const result = formatMcpArgs({
			server_name: "s",
			tool_name: "t",
			arguments: "not-an-object",
		});
		expect(result.label).toBe("s · t");
		expect(result.lines).toEqual([]);
	});
});
