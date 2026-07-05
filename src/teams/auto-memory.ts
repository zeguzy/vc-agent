import { compressMemberIndex } from "./compress.js";
import type { TeamFiles } from "./files.js";
import type { MemberIndexStructure, MemberName, MemoryType } from "./types-v2.js";

// ─── Compaction Summary Parsing ──────────────────────────────

interface ParsedSummary {
	goal: string;
	progress: string;
	learnings: LearningsByType;
	nextSteps: string;
}

type LearningsByType = Partial<Record<MemoryType, string>>;

/** Parse a compaction summary into structured sections. */
export function parseCompactionSummary(summary: string): ParsedSummary {
	const sections = splitByHeader(summary);
	return {
		goal: sections.get("Goal") ?? sections.get("goal") ?? "",
		progress: sections.get("Progress") ?? sections.get("progress") ?? "",
		learnings: classifyLearnings(sections.get("Learnings") ?? sections.get("learnings") ?? ""),
		nextSteps: sections.get("Next Steps") ?? sections.get("next steps") ?? "",
	};
}

/** Classify learnings text into memory types based on heuristics. */
function classifyLearnings(raw: string): LearningsByType {
	if (!raw.trim()) return {};

	const result: LearningsByType = {};
	const lines = raw.split("\n");
	let currentType: MemoryType | null = null;
	let currentLines: string[] = [];

	for (const line of lines) {
		// Detect type headers like "[user]", "[project]", etc.
		const typeMatch = line.match(/^\[(user|feedback|project|reference)\]/i);
		if (typeMatch) {
			if (currentType && currentLines.length > 0) {
				result[currentType] = currentLines.join("\n").trim();
			}
			currentType = typeMatch[1].toLowerCase() as MemoryType;
			currentLines = [];
			continue;
		}

		// Heuristic classification if no explicit type header
		if (!currentType) {
			const lower = line.toLowerCase();
			if (lower.includes("i prefer") || lower.includes("i like") || lower.includes("my style")) {
				currentType = "user";
			} else if (
				lower.includes("feedback") ||
				lower.includes("review noted") ||
				lower.includes("was told")
			) {
				currentType = "feedback";
			} else if (
				lower.includes("project uses") ||
				lower.includes("convention") ||
				lower.includes("standard")
			) {
				currentType = "project";
			} else if (
				lower.includes("api") ||
				lower.includes("reference") ||
				lower.includes("documentation")
			) {
				currentType = "reference";
			} else {
				currentType = "user"; // default
			}
		}

		currentLines.push(line);
	}

	if (currentType && currentLines.length > 0) {
		result[currentType] = currentLines.join("\n").trim();
	}

	return result;
}

// ─── Handle compaction_end ───────────────────────────────────

export interface AutoMemoryDeps {
	files: TeamFiles;
	memberName: MemberName;
	compactionSummary: string;
}

/**
 * Handle compaction_end event:
 * 1. Parse summary → extract learnings by type
 * 2. Write each type to corresponding topic file
 * 3. Update member .md index (Memory Index + Recent Activity)
 * 4. Trigger index compression if > 200 lines
 * 5. Return the updated index for re-injection
 */
export function handleCompactionEnd(deps: AutoMemoryDeps): MemberIndexStructure {
	const { files, memberName, compactionSummary } = deps;
	const parsed = parseCompactionSummary(compactionSummary);

	// Read current index (or create empty)
	let index = files.readMemberIndex(memberName) ?? {
		profile: { role: "", goal: "" },
		activeContext: "",
		memoryIndex: [],
		recentActivity: [],
	};

	// Write learnings to topic files
	const today = new Date().toISOString().slice(0, 10);
	for (const [type, content] of Object.entries(parsed.learnings)) {
		if (!content) continue;
		const memoryType = type as MemoryType;
		const topicName = `${memoryType}-learnings`;
		const existing = files.readTopicFile(memberName, topicName);
		const newContent = existing ? `${existing.content}\n\n## ${today}\n${content}` : content;
		files.writeTopicFile(memberName, topicName, memoryType, newContent, existing ?? undefined);

		// Update memory index if not already listed
		const alreadyListed = index.memoryIndex.some((m) => m.file === `${topicName}.md`);
		if (!alreadyListed) {
			index.memoryIndex.push({
				file: `${topicName}.md`,
				type: memoryType,
				description: `${memoryType} learnings`,
			});
		}
	}

	// Update active context from goal + next steps
	if (parsed.goal || parsed.nextSteps) {
		index.activeContext = [parsed.goal, parsed.nextSteps].filter(Boolean).join("\n\n");
	}

	// Add recent activity
	index.recentActivity.push({
		date: today,
		entry: "compaction — memory written",
	});

	// Compress if needed
	index = compressMemberIndex(index, compactionSummary);

	// Write updated index
	files.writeMemberIndex(memberName, index);

	return index;
}

// ─── Internal ────────────────────────────────────────────────

function splitByHeader(raw: string): Map<string, string> {
	const map = new Map<string, string>();
	const lines = raw.split("\n");
	let currentHeader = "";
	let currentLines: string[] = [];

	for (const line of lines) {
		if (line.startsWith("## ") || line.startsWith("# ")) {
			if (currentHeader) map.set(currentHeader, currentLines.join("\n"));
			currentHeader = line.replace(/^#+\s*/, "").trim();
			currentLines = [];
		} else {
			currentLines.push(line);
		}
	}
	if (currentHeader) map.set(currentHeader, currentLines.join("\n"));
	return map;
}
