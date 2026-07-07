import { describe, expect, it } from "bun:test";
import {
	DEFAULT_MEMBER_TOOLS,
	filterMemberTools,
	syncMemberAllowlist,
} from "../src/teams/manager-v2.js";

describe("filterMemberTools", () => {
	it("returns default tools when no requested list given", () => {
		const result = filterMemberTools(undefined);
		expect(result).toEqual(DEFAULT_MEMBER_TOOLS);
		expect(result).toContain("memory");
		expect(result).toContain("message");
	});

	it("returns default tools when empty array given", () => {
		const result = filterMemberTools([]);
		expect(result).toEqual(DEFAULT_MEMBER_TOOLS);
	});

	it("uses requested tools but always includes memory + message", () => {
		const result = filterMemberTools(["read", "edit", "bash"]);
		expect(result).toContain("read");
		expect(result).toContain("edit");
		expect(result).toContain("bash");
		expect(result).toContain("memory");
		expect(result).toContain("message");
	});

	it("strips NEVER_MEMBER_TOOLS even when explicitly requested", () => {
		const result = filterMemberTools(["subagent", "team", "question", "read"]);
		expect(result).not.toContain("subagent");
		expect(result).not.toContain("team");
		expect(result).not.toContain("question");
		expect(result).toContain("read");
	});

	it("deduplicates repeated entries", () => {
		const result = filterMemberTools(["read", "read", "bash", "bash"]);
		const reads = result.filter((t) => t === "read");
		expect(reads.length).toBe(1);
	});

	it("preserves memory when requested list tries to omit it", () => {
		const result = filterMemberTools(["read"]);
		expect(result).toContain("memory");
		expect(result).toContain("message");
	});

	it("accepts custom tool lists including edit/write/lsp", () => {
		const result = filterMemberTools(["read", "edit", "write", "lsp_diagnostics", "webfetch"]);
		expect(result).toEqual(
			expect.arrayContaining([
				"read",
				"edit",
				"write",
				"lsp_diagnostics",
				"webfetch",
				"memory",
				"message",
			]),
		);
	});
});

describe("syncMemberAllowlist", () => {
	it("appends custom tool names missing from the base allowlist", () => {
		const result = syncMemberAllowlist(
			["read", "bash", "memory", "message"],
			[{ name: "memory" }, { name: "message" }, { name: "mcp" }],
		);
		expect(result).toContain("mcp");
		expect(result.filter((n) => n === "mcp")).toHaveLength(1);
	});

	it("does not duplicate names already present in the base allowlist", () => {
		const result = syncMemberAllowlist(
			["read", "memory", "message"],
			[{ name: "memory" }, { name: "message" }, { name: "mcp" }],
		);
		expect(result.filter((n) => n === "memory")).toHaveLength(1);
		expect(result.filter((n) => n === "message")).toHaveLength(1);
	});

	it("returns the base allowlist unchanged when customTools is empty", () => {
		const base = ["read", "bash", "memory", "message"];
		const result = syncMemberAllowlist(base, []);
		expect(result).toEqual(base);
	});

	it("appends every custom tool name, not just 'mcp'", () => {
		const result = syncMemberAllowlist(
			["read"],
			[{ name: "memory" }, { name: "message" }, { name: "mcp" }, { name: "custom-thing" }],
		);
		expect(result).toEqual(["read", "memory", "message", "mcp", "custom-thing"]);
	});

	it("does not mutate the input base array", () => {
		const base = ["read", "memory"];
		syncMemberAllowlist(base, [{ name: "mcp" }]);
		expect(base).toEqual(["read", "memory"]);
	});

	it("regression: member with MCP customTool gets 'mcp' in allowlist (8abac6a bug class)", () => {
		const assignedTools = filterMemberTools(["read", "bash"]);
		const memberCustomTools = [{ name: "memory" }, { name: "message" }, { name: "mcp" }];
		const allowlist = syncMemberAllowlist(assignedTools, memberCustomTools);
		expect(allowlist).toContain("mcp");
		memberCustomTools.forEach((t) => {
			expect(allowlist).toContain(t.name);
		});
	});

	it("regression: member without MCP customTool does not get 'mcp' in allowlist", () => {
		const assignedTools = filterMemberTools(["read", "bash"]);
		const memberCustomTools = [{ name: "memory" }, { name: "message" }];
		const allowlist = syncMemberAllowlist(assignedTools, memberCustomTools);
		expect(allowlist).not.toContain("mcp");
	});
});
