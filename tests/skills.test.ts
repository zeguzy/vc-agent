import { describe, expect, it } from "bun:test";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { existsSync } from "fs";
import { mkdir, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { SkillManager } from "../src/skills/manager.js";

const inMemorySettings = SettingsManager.inMemory();

describe("SkillManager", () => {
	it("returns default directories", () => {
		const mgr = new SkillManager();
		const dirs = mgr.getDefaultDirectories();
		expect(dirs.global).toContain(".config/openagent/skills");
		expect(dirs.project).toContain(".openagent/skills");
	});

	it("throws when loading skill before initialize", async () => {
		const mgr = new SkillManager();
		await expect(mgr.loadDynamicSkill("/tmp")).rejects.toThrow("SkillManager not initialized");
	});

	it("throws when loading non-existent path", async () => {
		const tmp = join(tmpdir(), "skill-test-nonexistent-" + Date.now());
		const mgr = new SkillManager();
		// We need initialized state to test this
		const cwd = join(tmpdir(), "skill-test-cwd-" + Date.now());
		await mkdir(cwd, { recursive: true });
		try {
			await mgr.initialize(cwd, {}, inMemorySettings);
			await expect(mgr.loadDynamicSkill(tmp)).rejects.toThrow("Skill path does not exist");
		} finally {
			await import("fs/promises").then((m) => m.rm(cwd, { recursive: true, force: true }));
		}
	});

	it("listSkills returns empty arrays before initialize", () => {
		const mgr = new SkillManager();
		const result = mgr.listSkills();
		expect(result.skills).toEqual([]);
		expect(result.diagnostics).toEqual([]);
	});

	it("can load a valid SKILL.md file dynamically", async () => {
		const cwd = join(tmpdir(), "skill-test-load-" + Date.now());
		const skillDir = join(cwd, "test-skill");
		const skillFile = join(skillDir, "SKILL.md");

		await mkdir(skillDir, { recursive: true });
		await writeFile(
			skillFile,
			`---
name: test-skill
description: A test skill for unit testing
---

Hello, this is a test skill.
`,
		);

		const mgr = new SkillManager();
		try {
			await mgr.initialize(cwd, {}, inMemorySettings);
			const result = await mgr.loadDynamicSkill(skillDir);
			expect(result.skill.name).toBe("test-skill");
			expect(result.skill.description).toBe("A test skill for unit testing");
			expect(result.diagnostics).toBeDefined();

			// Should appear in list
			const list = mgr.listSkills();
			const dynamic = list.skills.filter((s) => s.source === "dynamic");
			expect(dynamic).toHaveLength(1);
			expect(dynamic[0].name).toBe("test-skill");
		} finally {
			await import("fs/promises").then((m) => m.rm(cwd, { recursive: true, force: true }));
		}
	});

	it("can unload a dynamically loaded skill", async () => {
		const cwd = join(tmpdir(), "skill-test-unload-" + Date.now());
		const skillDir = join(cwd, "unload-skill");
		const skillFile = join(skillDir, "SKILL.md");

		await mkdir(skillDir, { recursive: true });
		await writeFile(
			skillFile,
			`---
name: unload-me
description: Will be unloaded
---

Goodbye test.
`,
		);

		const mgr = new SkillManager();
		try {
			await mgr.initialize(cwd, {}, inMemorySettings);
			await mgr.loadDynamicSkill(skillDir);

			expect(mgr.listSkills().skills.filter((s) => s.source === "dynamic")).toHaveLength(1);

			const removed = mgr.unloadDynamicSkill("unload-me");
			expect(removed).toBe(true);

			expect(mgr.listSkills().skills.filter((s) => s.source === "dynamic")).toHaveLength(0);

			// Unloading non-existent returns false
			expect(mgr.unloadDynamicSkill("nonexistent")).toBe(false);
		} finally {
			await import("fs/promises").then((m) => m.rm(cwd, { recursive: true, force: true }));
		}
	});

	it("rejects duplicate dynamic skill name", async () => {
		const cwd = join(tmpdir(), "skill-test-dup-" + Date.now());
		const skillDir1 = join(cwd, "skill1");
		const skillDir2 = join(cwd, "skill2");
		const skillFile1 = join(skillDir1, "SKILL.md");
		const skillFile2 = join(skillDir2, "SKILL.md");

		await mkdir(skillDir1, { recursive: true });
		await mkdir(skillDir2, { recursive: true });
		await writeFile(skillFile1, "---\nname: same-name\ndescription: first\n---\n\nFirst");
		await writeFile(skillFile2, "---\nname: same-name\ndescription: second\n---\n\nSecond");

		const mgr = new SkillManager();
		try {
			await mgr.initialize(cwd, {}, inMemorySettings);
			await mgr.loadDynamicSkill(skillDir1);
			await expect(mgr.loadDynamicSkill(skillDir2)).rejects.toThrow("is already loaded");
		} finally {
			await import("fs/promises").then((m) => m.rm(cwd, { recursive: true, force: true }));
		}
	});
});
