import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAvailableSkillsPrompt, discoverAvailableSkills } from "../src/agents/discover.js";

let tmpDir: string;

beforeAll(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "discover-skills-test-"));
});

afterAll(() => {
	rmSync(tmpDir, { recursive: true, force: true });
});

function createSkillDir(baseDir: string, skillName: string, frontmatter: Record<string, unknown>) {
	const skillDir = join(baseDir, skillName);
	mkdirSync(skillDir, { recursive: true });
	const fm = Object.entries(frontmatter)
		.map(([k, v]) => `${k}: ${typeof v === "string" ? JSON.stringify(v) : v}`)
		.join("\n");
	writeFileSync(join(skillDir, "SKILL.md"), `---\n${fm}\n---\n\n# ${skillName}\n`);
}

describe("discoverAvailableSkills", () => {
	it("discovers skills from project .opencode/skills/ directory", () => {
		const projectSkillsDir = join(tmpDir, ".opencode", "skills");
		createSkillDir(projectSkillsDir, "test-skill", {
			name: "test-skill",
			description: "A test skill for unit testing",
		});

		const skills = discoverAvailableSkills(tmpDir);
		expect(skills.length).toBeGreaterThanOrEqual(1);
		const found = skills.find((s) => s.name === "test-skill");
		expect(found).toBeDefined();
		expect(found?.source).toBe("project");
		expect(found?.description).toBe("A test skill for unit testing");
	});

	it("skips SKILL.md with missing name", () => {
		const projectSkillsDir = join(tmpDir, ".opencode", "skills");
		createSkillDir(projectSkillsDir, "no-name-skill", {
			description: "Skill without a name",
		});

		const skills = discoverAvailableSkills(tmpDir);
		expect(skills.find((s) => s.description === "Skill without a name")).toBeUndefined();
	});

	it("skips SKILL.md with missing description", () => {
		const projectSkillsDir = join(tmpDir, ".opencode", "skills");
		createSkillDir(projectSkillsDir, "no-desc-skill", {
			name: "no-desc-skill",
		});

		const skills = discoverAvailableSkills(tmpDir);
		expect(skills.find((s) => s.name === "no-desc-skill")).toBeUndefined();
	});

	it("project skills take precedence over global skills with same name", () => {
		const projectSkillsDir = join(tmpDir, ".opencode", "skills");
		createSkillDir(projectSkillsDir, "dup-skill", {
			name: "dup-skill",
			description: "Project version",
		});

		const skills = discoverAvailableSkills(tmpDir);
		const dup = skills.find((s) => s.name === "dup-skill");
		expect(dup).toBeDefined();
		expect(dup?.source).toBe("project");
		expect(dup?.description).toBe("Project version");
	});

	it("returns empty array when no skills directories exist", () => {
		const emptyTmp = mkdtempSync(join(tmpdir(), "discover-skills-empty-"));
		try {
			const skills = discoverAvailableSkills(emptyTmp);
			expect(skills).toEqual([]);
		} finally {
			rmSync(emptyTmp, { recursive: true, force: true });
		}
	});
});

describe("buildAvailableSkillsPrompt", () => {
	it("returns undefined when no skills exist", () => {
		const emptyTmp = mkdtempSync(join(tmpdir(), "discover-skills-prompt-"));
		try {
			const result = buildAvailableSkillsPrompt(emptyTmp);
			expect(result).toBeUndefined();
		} finally {
			rmSync(emptyTmp, { recursive: true, force: true });
		}
	});

	it("returns formatted markdown with skills", () => {
		const projectSkillsDir = join(tmpDir, ".opencode", "skills");
		createSkillDir(projectSkillsDir, "prompt-skill", {
			name: "prompt-skill",
			description: "Skill for prompt test",
		});

		const result = buildAvailableSkillsPrompt(tmpDir);
		expect(result).toBeDefined();
		expect(result!).toContain("## Available Skills");
		expect(result!).toContain('skills=["harness"]');
		expect(result!).toContain("**prompt-skill** (project): Skill for prompt test");
	});
});
