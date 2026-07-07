import { describe, expect, it } from "bun:test";
import { DEFAULT_MEMBER_TOOLS, filterMemberTools } from "../src/teams/manager-v2.js";

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
