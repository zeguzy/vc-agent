import type { MemberIndexStructure } from "./types-v2.js";

const MAX_INDEX_LINES = 200;
const MAX_RECENT_ACTIVITY = 20;
const MAX_ACTIVE_CONTEXT_CHARS = 500;

/** Compress a member index if it exceeds the line limit. Returns the (possibly compressed) index. */
export function compressMemberIndex(
	index: MemberIndexStructure,
	compactionSummary?: string,
): MemberIndexStructure {
	// Quick check: if within limits, no compression needed
	const estimatedLines = estimateIndexLines(index);
	if (estimatedLines <= MAX_INDEX_LINES) return index;

	// Compress: truncate recent activity, condense active context
	const compressed: MemberIndexStructure = {
		profile: index.profile,
		activeContext: compactionSummary
			? compactionSummary.slice(0, MAX_ACTIVE_CONTEXT_CHARS)
			: index.activeContext.slice(0, MAX_ACTIVE_CONTEXT_CHARS),
		memoryIndex: index.memoryIndex,
		recentActivity: index.recentActivity.slice(-MAX_RECENT_ACTIVITY),
	};

	return compressed;
}

/** Estimate the number of lines a serialized index would produce. */
function estimateIndexLines(index: MemberIndexStructure): number {
	let lines = 6; // header + profile section markers
	lines += 3; // Role, Goal lines
	if (index.profile.model) lines += 1;
	lines += 2; // Active Context markers
	lines += Math.ceil(index.activeContext.length / 80); // rough line estimate
	lines += 2; // Memory Index markers
	lines += index.memoryIndex.length;
	lines += 2; // Recent Activity markers
	lines += index.recentActivity.length;
	return lines;
}
