import {
	DefaultResourceLoader,
	type LoadSkillsResult,
	loadSkillsFromDir,
	type ResourceDiagnostic,
	type Skill,
} from "@earendil-works/pi-coding-agent";
import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { Config } from "../config.js";

export interface SkillListEntry {
	name: string;
	description: string;
	source: "auto" | "dynamic";
	filePath: string;
	disableModelInvocation: boolean;
}

export interface SkillListResult {
	skills: SkillListEntry[];
	diagnostics: ResourceDiagnostic[];
}

export interface DynamicLoadResult {
	skill: Skill;
	diagnostics: ResourceDiagnostic[];
}

const GLOBAL_SKILLS_DIR = join(homedir(), ".config", "openagent", "skills");
const PROJECT_SKILLS_DIR = ".openagent/skills";

function resolveProjectSkillsDir(cwd: string): string {
	return join(cwd, PROJECT_SKILLS_DIR);
}

/**
 * SkillManager — manages auto-discovered and dynamically-loaded skills.
 *
 * Auto-loaded skills:
 *   Discovered at startup from ~/.config/openagent/skills/ and <cwd>/.openagent/skills/
 *   (plus any configured additional paths). These are injected into the agent's
 *   system prompt by the Pi SDK's DefaultResourceLoader.
 *
 * Dynamic skills:
 *   Loaded at runtime via loadDynamicSkill(). They are held in-memory and made
 *   available through the resource loader for /skill:name expansion.
 */
export class SkillManager {
	private _loader: DefaultResourceLoader | null = null;
	private _dynamicSkills: Skill[] = [];
	private _cwd: string = "";
	private _agentDir: string = "";

	/** Directory where global skills are stored */
	get agentDir(): string {
		return this._agentDir;
	}

	/** The underlying DefaultResourceLoader, if initialized */
	get resourceLoader(): DefaultResourceLoader | null {
		return this._loader;
	}

	/**
	 * Initialize the SkillManager.
	 * Creates a DefaultResourceLoader with openagent-specific paths and loads
	 * auto-discovered skills. Returns the configured resource loader.
	 */
	async initialize(cwd: string, config: Config): Promise<DefaultResourceLoader> {
		this._cwd = cwd;
		this._agentDir = join(homedir(), ".config", "openagent");

		const disabledSkills = config.skills?.disabled ?? [];
		const disabledSet = new Set(disabledSkills);

		const loader = new DefaultResourceLoader({
			cwd,
			agentDir: this._agentDir,
			additionalSkillPaths: config.skills?.paths ?? [],
			noSkills: config.skills?.autoLoad === false,
			systemPrompt: [
				"You are openagent, a terminal coding assistant.",
				"You help users by reading files, executing commands, editing code, and writing new files.",
				"",
				"Guidelines:",
				"- Be concise in your responses.",
				"- Show file paths clearly when working with files.",
				"- When a task involves multiple steps, break it down and work through it methodically.",
			].join("\n"),
			skillsOverride: (base: { skills: Skill[]; diagnostics: ResourceDiagnostic[] }) => {
				if (disabledSet.size === 0) return base;
				return {
					...base,
					skills: base.skills.filter((s) => !disabledSet.has(s.name)),
				};
			},
		});

		await loader.reload();
		this._loader = loader;
		return loader;
	}

	/**
	 * List all loaded skills, both auto-discovered and dynamically loaded.
	 * Deduplicates: if a skill appears in both auto and dynamic, the dynamic
	 * entry takes precedence (it was explicitly loaded by the user at runtime).
	 */
	listSkills(): SkillListResult {
		const loadedSkills = this._loader?.getSkills().skills ?? [];
		const diagnostics = this._loader?.getSkills().diagnostics ?? [];
		const dynamicNames = new Set(this._dynamicSkills.map((s) => s.name));

		// Auto skills: from loader, minus any that are also in dynamic list
		const autoEntries: SkillListEntry[] = loadedSkills
			.filter((s) => !dynamicNames.has(s.name))
			.map((s) => ({
				name: s.name,
				description: s.description,
				source: "auto" as const,
				filePath: s.filePath,
				disableModelInvocation: s.disableModelInvocation,
			}));

		const dynamicEntries: SkillListEntry[] = this._dynamicSkills.map((s) => ({
			name: s.name,
			description: s.description,
			source: "dynamic" as const,
			filePath: s.filePath,
			disableModelInvocation: s.disableModelInvocation,
		}));

		return { skills: [...autoEntries, ...dynamicEntries], diagnostics };
	}

	/**
	 * Dynamically load a skill from a file or directory path at runtime.
	 * The skill is added to the resource loader for /skill:name expansion.
	 * Throws if the path contains no valid skill or if a skill with the same name is already loaded.
	 */
	async loadDynamicSkill(path: string): Promise<DynamicLoadResult> {
		if (!this._loader) {
			throw new Error("SkillManager not initialized. Call initialize() first.");
		}

		if (!existsSync(path)) {
			throw new Error(`Skill path does not exist: ${path}`);
		}

		const result: LoadSkillsResult = loadSkillsFromDir({ dir: path, source: "dynamic" });

		if (result.skills.length === 0) {
			throw new Error(
				`No skill found at: ${path}. Skills must be SKILL.md files or directories containing SKILL.md.`,
			);
		}

		const skill = result.skills[0];

		// Check for duplicate names across auto + dynamic
		const allSkills = this.listSkills();
		const exists = allSkills.skills.some((s) => s.name === skill.name);
		if (exists) {
			throw new Error(
				`Skill "${skill.name}" is already loaded (source: ${allSkills.skills.find((s) => s.name === skill.name)?.source}). Use /unload-skill first if you need to replace it.`,
			);
		}

		this._dynamicSkills.push(skill);

		// Inject into resource loader so Pi SDK can expand /skill:name commands
		this._loader.extendResources({
			skillPaths: [{ path, metadata: { source: "user", scope: "temporary", origin: "top-level" } }],
		});

		return { skill, diagnostics: result.diagnostics };
	}

	/**
	 * Unload a dynamically loaded skill by name.
	 * Returns true if the skill was found and removed, false otherwise.
	 */
	unloadDynamicSkill(name: string): boolean {
		const idx = this._dynamicSkills.findIndex((s) => s.name === name);
		if (idx === -1) return false;
		this._dynamicSkills.splice(idx, 1);
		return true;
	}

	/**
	 * Resolve the default skill discovery directories for display / debugging.
	 */
	getDefaultDirectories(): { global: string; project: string } {
		return {
			global: GLOBAL_SKILLS_DIR,
			project: resolveProjectSkillsDir(this._cwd),
		};
	}
}
