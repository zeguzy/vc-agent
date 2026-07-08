// SPDX-License-Identifier: AGPL-3.0-or-later
// Derived from opencode-dynamic-context-pruning v3.1.14 (https://github.com/Opencode-DCP/opencode-dynamic-context-pruning)
// Copyright (c) opencode-dcp contributors. Licensed under AGPL-3.0-or-later.

import type { SessionState } from "../state-types.js";
import { resolveAnchorMessageId, resolveBoundaryIds, resolveSelection } from "./search.js";
import type {
	BoundaryReference,
	CompressRangeToolArgs,
	RangePlan,
	SearchContext,
	SelectionResolution,
} from "./types.js";

const BLOCK_REF_PATTERN = /\bb(\d+)\b/g;

export function validateArgs(args: CompressRangeToolArgs): void {
	if (!args.topic || typeof args.topic !== "string") {
		throw new Error("compress range: topic is required");
	}
	if (!Array.isArray(args.content) || args.content.length === 0) {
		throw new Error("compress range: content must be a non-empty array");
	}
	for (const entry of args.content) {
		if (!entry.startId || !entry.endId || !entry.summary) {
			throw new Error("compress range: each entry requires startId, endId, and summary");
		}
	}
}

export function resolveRanges(
	args: CompressRangeToolArgs,
	context: SearchContext,
	state: SessionState,
): RangePlan[] {
	const plans: RangePlan[] = [];
	for (const entry of args.content) {
		const { startReference, endReference } = resolveBoundaryIds(
			context,
			state,
			entry.startId,
			entry.endId,
		);
		const selection: SelectionResolution = resolveSelection(context, startReference, endReference);
		const anchorMessageId = resolveAnchorMessageId(startReference);
		plans.push({ entry, selection, anchorMessageId });
	}
	return plans;
}

export function validateNonOverlapping(plans: RangePlan[]): void {
	const ranges: Array<{ start: number; end: number; index: number }> = plans.map((p, i) => ({
		start: p.selection.startReference.rawIndex,
		end: p.selection.endReference.rawIndex,
		index: i,
	}));
	ranges.sort((a, b) => a.start - b.start);
	for (let i = 1; i < ranges.length; i++) {
		const prev = ranges[i - 1]!;
		const curr = ranges[i]!;
		if (curr.start <= prev.end) {
			throw new Error(
				`Overlapping ranges detected: range ${prev.index + 1} and range ${curr.index + 1} overlap`,
			);
		}
	}
}

export function parseBlockPlaceholders(summary: string): string[] {
	const matches: string[] = [];
	BLOCK_REF_PATTERN.lastIndex = 0;
	let match = BLOCK_REF_PATTERN.exec(summary);
	while (match !== null) {
		const ref = match[0];
		if (ref && !matches.includes(ref)) {
			matches.push(ref);
		}
		match = BLOCK_REF_PATTERN.exec(summary);
	}
	return matches;
}

export function validateSummaryPlaceholders(
	placeholders: string[],
	requiredBlockIds: number[],
	_startRef: BoundaryReference,
	_endRef: BoundaryReference,
	summaryByBlockId: Map<number, { summary: string }>,
): string[] {
	const missing: string[] = [];
	for (const ref of placeholders) {
		const blockId = Number.parseInt(ref.slice(1), 10);
		if (Number.isNaN(blockId)) continue;
		if (!summaryByBlockId.has(blockId) && !requiredBlockIds.includes(blockId)) {
			missing.push(ref);
		}
	}
	return missing;
}

export function injectBlockPlaceholders(
	summary: string,
	placeholders: string[],
	summaryByBlockId: Map<number, { summary: string }>,
	_startRef: BoundaryReference,
	_endRef: BoundaryReference,
): { expandedSummary: string; consumedBlockIds: number[] } {
	let expanded = summary;
	const consumed: number[] = [];
	for (const ref of placeholders) {
		const blockId = Number.parseInt(ref.slice(1), 10);
		if (Number.isNaN(blockId)) continue;
		const block = summaryByBlockId.get(blockId);
		if (!block) continue;
		expanded = expanded.replace(new RegExp(`\\b${ref}\\b`, "g"), block.summary);
		consumed.push(blockId);
	}
	return { expandedSummary: expanded, consumedBlockIds: consumed };
}

export function appendMissingBlockSummaries(
	summary: string,
	missingIds: string[],
	summaryByBlockId: Map<number, { summary: string }>,
	consumedBlockIds: number[],
): { expandedSummary: string; consumedBlockIds: number[] } {
	let expanded = summary;
	const consumed = [...consumedBlockIds];
	for (const ref of missingIds) {
		const blockId = Number.parseInt(ref.slice(1), 10);
		if (Number.isNaN(blockId)) continue;
		const block = summaryByBlockId.get(blockId);
		if (!block) continue;
		expanded = `${expanded}\n\n[${ref}]: ${block.summary}`;
		if (!consumed.includes(blockId)) {
			consumed.push(blockId);
		}
	}
	return { expandedSummary: expanded, consumedBlockIds: consumed };
}
