// SPDX-License-Identifier: AGPL-3.0-or-later
// Derived from opencode-dynamic-context-pruning v3.1.14 (https://github.com/Opencode-DCP/opencode-dynamic-context-pruning)
// Copyright (c) opencode-dcp contributors. Licensed under AGPL-3.0-or-later.

import type {
	AppliedCompressionResult,
	CompressionStateInput,
	SelectionResolution,
} from "../compress/types.js";
import type { CompressionBlock, SessionState } from "../state-types.js";

export function allocateBlockId(state: SessionState): number {
	return state.prune.messages.nextBlockId++;
}

export function allocateRunId(state: SessionState): number {
	return state.prune.messages.nextRunId++;
}

export function wrapCompressedSummary(blockId: number, summary: string): string {
	return `<compressed-block id="b${blockId}">\n${summary}\n</compressed-block>`;
}

export function applyCompressionState(
	state: SessionState,
	input: CompressionStateInput,
	selection: SelectionResolution,
	anchorMessageId: string | undefined,
	blockId: number,
	wrappedSummary: string,
	consumedBlockIds: number[],
): AppliedCompressionResult {
	const resolvedAnchor = anchorMessageId ?? input.compressMessageId;

	const block: CompressionBlock = {
		blockId,
		runId: input.runId,
		summary: wrappedSummary,
		active: true,
		topic: input.batchTopic,
		mode: input.mode,
		anchorMessageId: resolvedAnchor,
		messageIds: [...selection.messageIds],
		toolIds: [...selection.toolIds],
		tokenCount: input.summaryTokens,
		consumedBlockIds: [...consumedBlockIds],
		createdAt: Date.now(),
	};

	state.prune.messages.blocksById.set(blockId, block);
	state.prune.messages.activeBlockIds.add(blockId);

	for (const id of selection.messageIds) {
		state.messageIds.byRef.delete(id);
	}

	for (const id of selection.toolIds) {
		state.toolIds.delete(id);
	}

	const compressedTokens = Array.from(selection.messageTokenById.values()).reduce(
		(a, b) => a + b,
		0,
	);

	state.stats.totalPruneTokens += compressedTokens;
	state.stats.pruneTokenCounter += compressedTokens;
	state.stats.totalCompressions++;

	return {
		compressedTokens,
		newlyCompressedMessageIds: [...selection.messageIds],
		newlyCompressedToolIds: [...selection.toolIds],
	};
}
