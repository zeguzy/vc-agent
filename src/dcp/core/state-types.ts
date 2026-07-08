// SPDX-License-Identifier: AGPL-3.0-or-later
// Derived from opencode-dynamic-context-pruning v3.1.14 (https://github.com/Opencode-DCP/opencode-dynamic-context-pruning)
// Copyright (c) opencode-dcp contributors. Licensed under AGPL-3.0-or-later.

/**
 * Core DCP state types shared across all modules.
 */

/** A single message part (text, tool call, tool result, etc.). */
export interface MessagePart {
	type: string;
	text?: string;
	callID?: string;
	name?: string;
	input?: unknown;
	output?: string;
}

/** DCP-internal message representation with extracted parts. */
export interface WithParts {
	info: {
		id: string;
		role: string;
		sessionId?: string;
	};
	parts: MessagePart[];
}

/** A compression block replacing a range/message of conversation. */
export interface CompressionBlock {
	blockId: number;
	runId: number;
	summary: string;
	active: boolean;
	topic: string;
	mode: "range" | "message";
	anchorMessageId: string;
	messageIds: string[];
	toolIds: string[];
	tokenCount: number;
	consumedBlockIds: number[];
	createdAt: number;
}

/** Anchor types for nudge throttling. */
export type AnchorType = "context-limit" | "turn-boundary" | "iteration";

/** Session-level DCP state. */
export interface SessionState {
	sessionId?: string;
	compressPermission: "allow" | "deny" | "ask";

	messageIds: {
		/** messageRef (mNNNN) -> messageId */
		byRef: Map<string, string>;
	};

	prune: {
		messages: {
			activeBlockIds: Set<number>;
			blocksById: Map<number, CompressionBlock>;
			nextBlockId: number;
			nextRunId: number;
		};
	};

	toolIds: Set<string>;

	stats: {
		totalPruneTokens: number;
		pruneTokenCounter: number;
		totalCompressions: number;
	};

	anchors: Set<AnchorType>;
	lastAnchorIndex: Map<AnchorType, number>;
	llmCallCount: number;
	lastUserMessageIndex: number | undefined;
	lastCompressTurn: number | undefined;
}

/** Create a fresh SessionState with defaults. */
export function createSessionState(sessionId?: string): SessionState {
	return {
		sessionId,
		compressPermission: "allow",
		messageIds: { byRef: new Map() },
		prune: {
			messages: {
				activeBlockIds: new Set(),
				blocksById: new Map(),
				nextBlockId: 1,
				nextRunId: 1,
			},
		},
		toolIds: new Set(),
		stats: {
			totalPruneTokens: 0,
			pruneTokenCounter: 0,
			totalCompressions: 0,
		},
		anchors: new Set(),
		lastAnchorIndex: new Map(),
		llmCallCount: 0,
		lastUserMessageIndex: undefined,
		lastCompressTurn: undefined,
	};
}
