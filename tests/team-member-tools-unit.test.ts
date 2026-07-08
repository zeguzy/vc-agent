import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	buildMemberToolDefinitions,
	filterMemberTools,
	syncMemberAllowlist,
} from "../src/teams/manager-v2.js";

const TMP = mkdtempSync(join(tmpdir(), "member-tools-test-"));

// ─── filterMemberTools ──────────────────────────────────────

describe("filterMemberTools", () => {
	it("returns DEFAULT_MEMBER_TOOLS when no tools requested", () => {
		const result = filterMemberTools();
		expect(result).toContain("read");
		expect(result).toContain("bash");
		expect(result).toContain("memory");
		expect(result).toContain("message");
	});

	it("includes edit/glob/todo/webfetch when requested", () => {
		const result = filterMemberTools(["read", "bash", "edit", "glob", "todo", "webfetch"]);
		expect(result).toContain("edit");
		expect(result).toContain("glob");
		expect(result).toContain("todo");
		expect(result).toContain("webfetch");
	});

	it("always includes memory and message even if not requested", () => {
		const result = filterMemberTools(["read", "bash"]);
		expect(result).toContain("memory");
		expect(result).toContain("message");
	});

	it("filters out NEVER_MEMBER_TOOLS", () => {
		const result = filterMemberTools(["read", "bash", "subagent", "team", "question"]);
		expect(result).not.toContain("subagent");
		expect(result).not.toContain("team");
		expect(result).not.toContain("question");
	});
});

// ─── buildMemberToolDefinitions ──────────────────────────────

describe("buildMemberToolDefinitions", () => {
	it("returns empty array when no custom tools assigned", () => {
		const tools = buildMemberToolDefinitions(["read", "bash", "memory", "message"], TMP);
		expect(tools.length).toBe(0);
	});

	it("creates edit tool definition when edit is assigned", () => {
		const tools = buildMemberToolDefinitions(["read", "bash", "edit"], TMP);
		expect(tools.some((t) => t.name === "edit")).toBe(true);
	});

	it("does NOT create edit tool when edit is not assigned", () => {
		const tools = buildMemberToolDefinitions(["read", "bash"], TMP);
		expect(tools.some((t) => t.name === "edit")).toBe(false);
	});

	it("creates glob tool definition when glob is assigned", () => {
		const tools = buildMemberToolDefinitions(["read", "bash", "glob"], TMP);
		expect(tools.some((t) => t.name === "glob")).toBe(true);
	});

	it("does NOT create glob tool when glob is not assigned", () => {
		const tools = buildMemberToolDefinitions(["read", "bash"], TMP);
		expect(tools.some((t) => t.name === "glob")).toBe(false);
	});

	it("creates todo tool definition when todo is assigned", () => {
		const tools = buildMemberToolDefinitions(["read", "bash", "todo"], TMP);
		expect(tools.some((t) => t.name === "todo")).toBe(true);
	});

	it("does NOT create todo tool when todo is not assigned", () => {
		const tools = buildMemberToolDefinitions(["read", "bash"], TMP);
		expect(tools.some((t) => t.name === "todo")).toBe(false);
	});

	it("creates webfetch tool definition when webfetch is assigned", () => {
		const tools = buildMemberToolDefinitions(["read", "bash", "webfetch"], TMP);
		expect(tools.some((t) => t.name === "webfetch")).toBe(true);
	});

	it("does NOT create webfetch tool when webfetch is not assigned", () => {
		const tools = buildMemberToolDefinitions(["read", "bash"], TMP);
		expect(tools.some((t) => t.name === "webfetch")).toBe(false);
	});

	it("creates all four tool definitions when all are assigned", () => {
		const tools = buildMemberToolDefinitions(
			["read", "bash", "edit", "glob", "todo", "webfetch"],
			TMP,
		);
		const names = tools.map((t) => t.name);
		expect(names).toContain("edit");
		expect(names).toContain("glob");
		expect(names).toContain("todo");
		expect(names).toContain("webfetch");
		expect(tools.length).toBe(4);
	});

	it("ignores Pi SDK builtins (read, bash, write, grep, find)", () => {
		const tools = buildMemberToolDefinitions(
			["read", "bash", "write", "grep", "find", "memory", "message"],
			TMP,
		);
		const names = tools.map((t) => t.name);
		expect(names).not.toContain("read");
		expect(names).not.toContain("bash");
		expect(names).not.toContain("write");
		expect(names).not.toContain("grep");
		expect(names).not.toContain("find");
		expect(names).not.toContain("memory");
		expect(names).not.toContain("message");
	});
});

// ─── syncMemberAllowlist ─────────────────────────────────────

describe("syncMemberAllowlist", () => {
	it("merges custom tool names into base tools", () => {
		const result = syncMemberAllowlist(["read", "bash"], [{ name: "edit" }, { name: "glob" }]);
		expect(result).toContain("read");
		expect(result).toContain("bash");
		expect(result).toContain("edit");
		expect(result).toContain("glob");
	});

	it("deduplicates when custom tool name already in base", () => {
		const result = syncMemberAllowlist(["read", "edit"], [{ name: "edit" }]);
		expect(result.filter((n) => n === "edit").length).toBe(1);
	});
});

// Cleanup
afterAll(() => {
	rmSync(TMP, { recursive: true, force: true });
});
