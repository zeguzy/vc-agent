import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TeamFiles } from "../src/teams/files.js";

describe("TeamFiles.writeSharedTopic — first-write lockfile fix", () => {
	let dir: string;
	let files: TeamFiles;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "shared-topic-test-"));
		files = new TeamFiles(dir);
		files.initTeamDir();
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("writes a new shared topic when the file does not yet exist (no ENOENT)", async () => {
		const topic = "architecture";
		const path = files.paths.sharedTopic(topic);
		expect(existsSync(path)).toBe(false);

		// Before the fix this threw ENOENT (proper-lockfile lstat on a
		// non-existent file). Now writeSharedTopic creates the file first.
		await files.writeSharedTopic(topic, "project", "body content", undefined);

		expect(existsSync(path)).toBe(true);
		const raw = readFileSync(path, "utf-8");
		expect(raw).toContain("body content");
	});

	it("updates an existing shared topic (second write keeps frontmatter)", async () => {
		const topic = "decisions";
		await files.writeSharedTopic(topic, "project", "v1 body", undefined);

		const existing = files.readSharedTopic(topic);
		expect(existing).not.toBeNull();
		await files.writeSharedTopic(topic, "project", "v2 body", existing ?? undefined);

		const raw = readFileSync(files.paths.sharedTopic(topic), "utf-8");
		expect(raw).toContain("v2 body");
		expect(raw).not.toContain("v1 body");
	});

	it("creates the shared topic even when sharedDir was just initialized (empty)", async () => {
		// initTeamDir created sharedDir but it's empty — first topic write must work.
		const topic = "first-ever";
		await files.writeSharedTopic(topic, "reference", "ref content", undefined);

		const raw = readFileSync(files.paths.sharedTopic(topic), "utf-8");
		expect(raw).toContain("ref content");
	});
});
