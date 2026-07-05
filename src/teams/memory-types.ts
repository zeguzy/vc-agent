import type { MemoryType, TopicFileFrontmatter } from "./types-v2.js";

// ─── Validation ──────────────────────────────────────────────

/** Allowed pattern for member names and topic names. */
const NAME_RE = /^[a-z0-9-]+$/;
const MAX_NAME_LEN = 64;

/** Validate a member name or topic name. Throws on invalid input. */
export function validateName(name: string, label: string): void {
	if (name.length === 0) throw new Error(`${label} must not be empty`);
	if (name.length > MAX_NAME_LEN) throw new Error(`${label} too long (max ${MAX_NAME_LEN})`);
	if (!NAME_RE.test(name)) {
		throw new Error(
			`${label} "${name}" invalid — only [a-z0-9-] allowed (no .. / \\ absolute paths)`,
		);
	}
}

/** Check if a file path is inside .openagent/team/ (for read blocking). */
export function isTeamPath(filePath: string): boolean {
	return filePath.includes(".openagent/team/") || filePath.includes(".openagent\\team\\");
}

// ─── Token Estimation ────────────────────────────────────────

/** Rough token estimation: ~4 chars per token for English/code mix. */
export function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

// ─── Frontmatter Parsing ────────────────────────────────────

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n/;

/** Parse YAML frontmatter from a topic .md file. Returns null if no valid frontmatter. */
export function parseFrontmatter(raw: string): {
	frontmatter: TopicFileFrontmatter;
	body: string;
} | null {
	const match = raw.match(FRONTMATTER_RE);
	if (!match) return null;

	const yaml = match[1];
	const body = raw.slice(match[0].length);

	const type = extractYamlField(yaml, "type") as MemoryType | null;
	const created = extractYamlField(yaml, "created");
	const updated = extractYamlField(yaml, "updated");
	const tokensStr = extractYamlField(yaml, "tokens");

	if (!type || !created || !updated) return null;

	const validTypes: MemoryType[] = ["user", "feedback", "project", "reference"];
	if (!validTypes.includes(type)) return null;

	return {
		frontmatter: {
			type,
			created,
			updated,
			tokens: tokensStr ? Number.parseInt(tokensStr, 10) || estimateTokens(body) : estimateTokens(body),
		},
		body,
	};
}

/** Serialize frontmatter + body into a complete .md file. */
export function serializeFrontmatter(fm: TopicFileFrontmatter, body: string): string {
	return `---\ntype: ${fm.type}\ncreated: ${fm.created}\nupdated: ${fm.updated}\ntokens: ${fm.tokens}\n---\n${body}`;
}

/** Create fresh frontmatter for a new topic file. */
export function createFrontmatter(type: MemoryType, body: string): TopicFileFrontmatter {
	const now = new Date().toISOString();
	return {
		type,
		created: now,
		updated: now,
		tokens: estimateTokens(body),
	};
}

/** Update frontmatter for an existing topic file (preserves created, updates updated/tokens). */
export function updateFrontmatter(existing: TopicFileFrontmatter, newBody: string): TopicFileFrontmatter {
	return {
		...existing,
		updated: new Date().toISOString(),
		tokens: estimateTokens(newBody),
	};
}

// ─── Internal ────────────────────────────────────────────────

/** Extract a single YAML field value (simple key: value parsing). */
function extractYamlField(yaml: string, key: string): string | null {
	const line = yaml.split("\n").find((l) => l.startsWith(`${key}:`));
	if (!line) return null;
	const value = line.slice(key.length + 1).trim();
	// Strip quotes if present
	if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
		return value.slice(1, -1);
	}
	return value || null;
}
