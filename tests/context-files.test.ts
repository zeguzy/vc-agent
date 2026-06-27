import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadSystemContext, resolveNearbyContext } from "../src/context-files.js";

const tmpBase = join(import.meta.dirname, ".tmp-test-context-files");

function writeFile(relativePath: string, content: string): string {
	const full = join(tmpBase, relativePath);
	mkdirSync(join(full, ".."), { recursive: true });
	writeFileSync(full, content, "utf-8");
	return full;
}

beforeEach(() => {
	rmSync(tmpBase, { recursive: true, force: true });
	mkdirSync(tmpBase, { recursive: true });
});

afterEach(() => {
	rmSync(tmpBase, { recursive: true, force: true });
});

describe("loadSystemContext", () => {
	it("returns base prompt when no local context files exist", async () => {
		const result = await loadSystemContext(tmpBase, {});
		expect(result).toContain("You are openagent");
		expect(result).toContain("Be concise");
		// May contain global AGENTS.md if it exists, but should NOT contain
		// any project-level instructions from the temp dir
		expect(result).not.toContain("Project rules");
	});

	it("loads project-level AGENTS.md found via findUp", async () => {
		writeFile("AGENTS.md", "Project rules: use tabs");
		const result = await loadSystemContext(tmpBase, {});
		expect(result).toContain("Instructions from:");
		expect(result).toContain("Project rules: use tabs");
	});

	it("falls back to CLAUDE.md when AGENTS.md absent", async () => {
		writeFile("CLAUDE.md", "Claude rules");
		const result = await loadSystemContext(tmpBase, {});
		expect(result).toContain("Instructions from:");
		expect(result).toContain("Claude rules");
	});

	it("prefers AGENTS.md over CLAUDE.md when both exist", async () => {
		writeFile("AGENTS.md", "AGENTS rules");
		writeFile("CLAUDE.md", "CLAUDE rules");
		const result = await loadSystemContext(tmpBase, {});
		expect(result).toContain("AGENTS rules");
		expect(result).not.toContain("CLAUDE rules");
	});

	it("finds AGENTS.md in ancestor directory", async () => {
		writeFile("AGENTS.md", "top-level rules");
		const subDir = join(tmpBase, "src", "auth");
		mkdirSync(subDir, { recursive: true });
		const result = await loadSystemContext(subDir, {});
		expect(result).toContain("top-level rules");
	});

	it("loads instructions from config paths", async () => {
		writeFile("docs/standards.md", "Use strict types");
		const result = await loadSystemContext(tmpBase, {
			instructions: ["docs/standards.md"],
		});
		expect(result).toContain("Use strict types");
	});

	it("skips non-existent instruction files silently", async () => {
		const result = await loadSystemContext(tmpBase, {
			instructions: ["nonexistent.md"],
		});
		expect(result).toContain("You are openagent");
		expect(result).not.toContain("nonexistent.md");
	});

	it("resolves ~/ expansion in instructions", async () => {
		const result = await loadSystemContext(tmpBase, {
			instructions: ["~/nonexistent-file-12345.md"],
		});
		// Should not crash on ~/ expansion
		expect(result).toContain("You are openagent");
	});

	it("combines multiple instruction sources in order", async () => {
		writeFile("AGENTS.md", "Project AGENTS");
		writeFile("docs/a.md", "Doc A");
		writeFile("docs/b.md", "Doc B");
		const result = await loadSystemContext(tmpBase, {
			instructions: ["docs/a.md", "docs/b.md"],
		});
		const agIdx = result.indexOf("Project AGENTS");
		const aIdx = result.indexOf("Doc A");
		const bIdx = result.indexOf("Doc B");
		expect(agIdx).toBeGreaterThan(-1);
		// AGENTS.md should appear before instruction files
		expect(agIdx).toBeLessThan(aIdx);
		expect(aIdx).toBeLessThan(bIdx);
	});
});

describe("resolveNearbyContext", () => {
	it("finds AGENTS.md in parent directories of a file", () => {
		writeFile("AGENTS.md", "Root AGENTS");
		writeFile("src/auth/AGENTS.md", "Auth AGENTS");
		const rootFile = join(tmpBase, "AGENTS.md");
		// Simulate root already loaded by loadSystemContext
		const result = resolveNearbyContext(
			join(tmpBase, "src", "auth", "login.ts"),
			tmpBase,
			new Set([rootFile]),
		);
		expect(result.length).toBe(1);
		expect(result[0].content).toContain("Auth AGENTS");
	});

	it("skips files already in loadedPaths", () => {
		writeFile("AGENTS.md", "Root AGENTS");
		writeFile("src/auth/AGENTS.md", "Auth AGENTS");
		const rootFile = join(tmpBase, "AGENTS.md");
		const result = resolveNearbyContext(
			join(tmpBase, "src", "auth", "login.ts"),
			tmpBase,
			new Set([rootFile]),
		);
		// Root is in loadedPaths, auth is the only new one
		expect(result.length).toBe(1);
		expect(result[0].content).toContain("Auth AGENTS");
	});

	it("returns empty when no AGENTS.md in parent chain", () => {
		mkdirSync(join(tmpBase, "src", "deep", "nested"), { recursive: true });
		const result = resolveNearbyContext(
			join(tmpBase, "src", "deep", "nested", "file.ts"),
			tmpBase,
			new Set(),
		);
		expect(result).toEqual([]);
	});

	it("returns empty for files outside cwd", () => {
		const result = resolveNearbyContext("/tmp/outside.ts", tmpBase, new Set());
		expect(result).toEqual([]);
	});
});
