// SPDX-License-Identifier: AGPL-3.0-or-later
// Derived from opencode-dynamic-context-pruning v3.1.14 (https://github.com/Opencode-DCP/opencode-dynamic-context-pruning)
// Copyright (c) opencode-dcp contributors. Licensed under AGPL-3.0-or-later.

import type { CompressionBlock, WithParts } from "../state-types.js";

export interface BoundaryReference {
	kind: "message" | "compressed-block";
	rawIndex: number;
	messageId?: string;
	blockId?: number;
	anchorMessageId?: string;
}

export interface SearchContext {
	rawMessages: WithParts[];
	rawMessagesById: Map<string, WithParts>;
	rawIndexById: Map<string, number>;
	summaryByBlockId: Map<number, CompressionBlock>;
}

export interface SelectionResolution {
	startReference: BoundaryReference;
	endReference: BoundaryReference;
	messageIds: string[];
	messageTokenById: Map<string, number>;
	toolIds: string[];
	requiredBlockIds: number[];
}

export interface CompressRangeToolArgs {
	topic: string;
	content: Array<{
		startId: string;
		endId: string;
		summary: string;
	}>;
}

export interface CompressMessageToolArgs {
	topic: string;
	content: Array<{
		messageId: string;
		topic: string;
		summary: string;
	}>;
}

export interface CompressionStateInput {
	topic: string;
	batchTopic: string;
	startId: string;
	endId: string;
	mode: "range" | "message";
	runId: number;
	compressMessageId: string;
	compressCallId?: string;
	summaryTokens: number;
}

export interface AppliedCompressionResult {
	compressedTokens: number;
	newlyCompressedMessageIds: string[];
	newlyCompressedToolIds: string[];
}

export interface RangePlan {
	entry: CompressRangeToolArgs["content"][number];
	selection: SelectionResolution;
	anchorMessageId: string;
}

export interface MessagePlan {
	entry: CompressMessageToolArgs["content"][number];
	selection: SelectionResolution;
	anchorMessageId: string;
}

export interface MessageResolutionResult {
	plans: MessagePlan[];
	skippedIssues: string[];
	skippedCount: number;
}
