import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TeamFiles } from "../src/teams/files.js";

let teamDir: string;
let files: TeamFiles;

beforeEach(() => {
	teamDir = mkdtempSync(join(tmpdir(), "team-constraints-test-"));
	files = new TeamFiles(teamDir);
	files.initTeamDir();
});

afterEach(() => {
	rmSync(teamDir, { recursive: true, force: true });
});

describe("## Constraints section serialization", () => {
	it("round-trips constraints through initMemberDir/readMemberIndex", () => {
		files.initMemberDir("alice", "reviewer", "goal", undefined, "must run tests");

		const idx = files.readMemberIndex("alice");
		expect(idx?.constraints).toBe("must run tests");
		expect(idx?.profile.role).toBe("reviewer");
	});

	it("returns undefined constraints when not provided (backward compatible)", () => {
		files.initMemberDir("bob", "role", "goal");

		const idx = files.readMemberIndex("bob");
		expect(idx?.constraints).toBeUndefined();
	});

	it("serializes ## Constraints section between Profile and Active Context", () => {
		files.initMemberDir("cara", "role", "goal", undefined, "constraint line");

		const raw = readFileSync(files.paths.memberIndex("cara"), "utf-8");
		const profileIdx = raw.indexOf("## Profile");
		const constraintsIdx = raw.indexOf("## Constraints");
		const activeIdx = raw.indexOf("## Active Context");

		expect(constraintsIdx).toBeGreaterThan(-1);
		expect(profileIdx).toBeLessThan(constraintsIdx);
		expect(constraintsIdx).toBeLessThan(activeIdx);
		expect(raw).toContain("constraint line");
	});

	it("does not write ## Constraints section when constraints absent", () => {
		files.initMemberDir("dave", "role", "goal");

		const raw = readFileSync(files.paths.memberIndex("dave"), "utf-8");
		expect(raw).not.toContain("## Constraints");
	});

	it("reads multi-line constraints correctly", () => {
		const multiLine = "line one\nline two\nline three";
		files.initMemberDir("eve", "role", "goal", undefined, multiLine);

		const idx = files.readMemberIndex("eve");
		expect(idx?.constraints).toBe(multiLine);
	});
});
