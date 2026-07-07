import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TeamFiles } from "../src/teams/files.js";

describe("TeamFiles member index round-trip with assignments", () => {
	let tmpDir: string;
	let files: TeamFiles;

	beforeAll(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "team-files-"));
		files = new TeamFiles(tmpDir);
		files.initTeamDir();
	});

	afterAll(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("writes and reads assignedTools/Skills/MCPs", () => {
		files.initMemberDir("alice", "frontend", "build UI");
		const idx = files.readMemberIndex("alice");
		expect(idx).not.toBeNull();
		if (!idx) return;
		idx.assignedTools = ["read", "edit", "bash"];
		idx.assignedSkills = ["frontend-conventions"];
		idx.assignedMcps = ["figma"];
		files.writeMemberIndex("alice", idx);

		const reread = files.readMemberIndex("alice");
		expect(reread?.assignedTools).toEqual(["read", "edit", "bash"]);
		expect(reread?.assignedSkills).toEqual(["frontend-conventions"]);
		expect(reread?.assignedMcps).toEqual(["figma"]);
	});

	it("returns undefined assignments when not written", () => {
		files.initMemberDir("bob", "dev", "x");
		const idx = files.readMemberIndex("bob");
		expect(idx?.assignedTools).toBeUndefined();
		expect(idx?.assignedSkills).toBeUndefined();
		expect(idx?.assignedMcps).toBeUndefined();
	});

	it("preserves assignments alongside constraints and active context", () => {
		files.initMemberDir("cara", "reviewer", "review code", undefined, "must run tests");
		const idx = files.readMemberIndex("cara");
		expect(idx).not.toBeNull();
		if (!idx) return;
		idx.assignedTools = ["read", "lsp_diagnostics"];
		idx.activeContext = "reviewing PR #42";
		files.writeMemberIndex("cara", idx);

		const reread = files.readMemberIndex("cara");
		expect(reread?.constraints).toBe("must run tests");
		expect(reread?.assignedTools).toEqual(["read", "lsp_diagnostics"]);
		expect(reread?.activeContext?.trim()).toBe("reviewing PR #42");
	});
});
