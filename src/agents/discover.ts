import { type Dirent, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import type { ModelTier } from "../config.js";
import { BUILTIN_AGENTS } from "./defaults.js";
import type {
	AgentConfig,
	AgentDiscoveryResult,
	AgentPermissionMode,
	AgentScope,
} from "./types.js";

const VALID_PERMISSION_MODES = new Set<AgentPermissionMode>(["default", "plan", "acceptEdits"]);
const VALID_TIERS = new Set<ModelTier>(["fast", "standard", "powerful"]);

function isDirectory(p: string): boolean {
	try {
		return statSync(p).isDirectory();
	} catch {
		return false;
	}
}

function loadAgentsFromDir(dir: string, source: "user" | "project"): AgentConfig[] {
	if (!isDirectory(dir)) return [];

	let entries: Dirent[];
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return [];
	}

	const agents: AgentConfig[] = [];
	for (const entry of entries) {
		if (!entry.name.endsWith(".md")) continue;
		if (!entry.isFile() && !entry.isSymbolicLink()) continue;

		const filePath = join(dir, entry.name);
		let content: string;
		try {
			content = readFileSync(filePath, "utf-8");
		} catch {
			continue;
		}

		const { frontmatter, body } = parseFrontmatter<Record<string, unknown>>(content);
		if (typeof frontmatter.name !== "string" || typeof frontmatter.description !== "string")
			continue;

		const tools =
			typeof frontmatter.tools === "string"
				? frontmatter.tools
						.split(",")
						.map((t) => t.trim())
						.filter(Boolean)
				: undefined;

		const disallowedTools = Array.isArray(frontmatter.disallowedTools)
			? frontmatter.disallowedTools.filter((t): t is string => typeof t === "string")
			: undefined;

		const maxTurns =
			typeof frontmatter.maxTurns === "number" && Number.isFinite(frontmatter.maxTurns)
				? frontmatter.maxTurns
				: undefined;

		const background =
			typeof frontmatter.background === "boolean" ? frontmatter.background : undefined;

		let permissionMode: AgentPermissionMode | undefined;
		if (typeof frontmatter.permissionMode === "string") {
			if (VALID_PERMISSION_MODES.has(frontmatter.permissionMode as AgentPermissionMode)) {
				permissionMode = frontmatter.permissionMode as AgentPermissionMode;
			} else {
				console.error(
					`[agents] ${entry.name}: invalid permissionMode "${frontmatter.permissionMode}" (must be one of: default, plan, acceptEdits) — ignoring`,
				);
			}
		}

		let tier: ModelTier | undefined;
		if (typeof frontmatter.tier === "string") {
			if (VALID_TIERS.has(frontmatter.tier as ModelTier)) {
				tier = frontmatter.tier as ModelTier;
			} else {
				console.error(
					`[agents] ${entry.name}: invalid tier "${frontmatter.tier}" (must be one of: fast, standard, powerful) — ignoring`,
				);
			}
		}

		agents.push({
			name: frontmatter.name,
			description: frontmatter.description,
			tools: tools && tools.length > 0 ? tools : undefined,
			model: typeof frontmatter.model === "string" ? frontmatter.model : undefined,
			systemPrompt: body,
			source,
			filePath,
			disallowedTools: disallowedTools && disallowedTools.length > 0 ? disallowedTools : undefined,
			maxTurns,
			background,
			permissionMode,
			tier,
		});
	}

	return agents;
}

function findNearestProjectAgentsDir(cwd: string): string | null {
	let currentDir = cwd;
	while (true) {
		const candidate = join(currentDir, ".openagent", "agents");
		if (isDirectory(candidate)) return candidate;

		const parent = dirname(currentDir);
		if (parent === currentDir) return null;
		currentDir = parent;
	}
}

export function getUserAgentsDir(): string {
	return join(homedir(), ".config", "openagent", "agents");
}

export function discoverAgents(cwd: string, scope: AgentScope = "both"): AgentDiscoveryResult {
	const userDir = getUserAgentsDir();
	const projectAgentsDir = findNearestProjectAgentsDir(cwd);

	const userAgents = scope === "project" ? [] : loadAgentsFromDir(userDir, "user");
	const projectAgents =
		scope === "user" || !projectAgentsDir ? [] : loadAgentsFromDir(projectAgentsDir, "project");

	const agentMap = new Map<string, AgentConfig>();
	for (const agent of BUILTIN_AGENTS) agentMap.set(agent.name, agent);
	for (const agent of userAgents) agentMap.set(agent.name, agent);
	for (const agent of projectAgents) agentMap.set(agent.name, agent);

	return { agents: Array.from(agentMap.values()), projectAgentsDir };
}

export function formatAgentList(
	agents: AgentConfig[],
	maxItems: number,
): {
	text: string;
	remaining: number;
} {
	if (agents.length === 0) return { text: "none", remaining: 0 };
	const listed = agents.slice(0, maxItems);
	const remaining = agents.length - listed.length;
	return {
		text: listed.map((a) => `${a.name} (${a.source}): ${a.description}`).join("; "),
		remaining,
	};
}

export function buildAvailableAgentsPrompt(agents: AgentConfig[]): string {
	if (agents.length === 0) return "";
	const lines = agents.map((a) => {
		const firstLine = a.description.split("\n")[0];
		const tools = a.tools?.length ? a.tools.join(", ") : "default";
		return `- **${a.name}** (${a.source}): ${firstLine} [tools: ${tools}]`;
	});
	return [
		"## Available subagents",
		"",
		lines.join("\n"),
		"",
		"Use these agents via the `subagent` tool. See the tool description for call syntax.",
	].join("\n");
}
