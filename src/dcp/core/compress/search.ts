// SPDX-License-Identifier: AGPL-3.0-or-later
// Derived from opencode-dynamic-context-pruning v3.1.14 (https://github.com/Opencode-DCP/opencode-dynamic-context-pruning)
// Copyright (c) opencode-dcp contributors. Licensed under AGPL-3.0-or-later.

/**
 * Boundary/selection resolution for compress-range. Pure functions.
 * The upstream `fetchSessionMessages` client call is removed; callers pass
 * the raw message list directly.
 */

import { formatBlockRef, parseBoundaryId, parseMessageRef } from "../message-ids.js";
import { isIgnoredUserMessage } from "../messages/query.js";
import type { CompressionBlock, SessionState, WithParts } from "../state-types.js";
import { countAllMessageTokens } from "../token-utils.js";
import type { BoundaryReference, SearchContext, SelectionResolution } from "./types.js";

/** Build a SearchContext: id/index lookups + active summary blocks. */
export function buildSearchContext(state: SessionState, rawMessages: WithParts[]): SearchContext {
	const rawMessagesById = new Map<string, WithParts>();
	const rawIndexById = new Map<string, number>();
	for (const msg of rawMessages) {
		rawMessagesById.set(msg.info.id, msg);
	}
	for (let index = 0; index < rawMessages.length; index++) {
		const message = rawMessages[index];
		if (!message) {
			continue;
		}
		rawIndexById.set(message.info.id, index);
	}

	const summaryByBlockId = new Map<number, CompressionBlock>();
	for (const [blockId, block] of state.prune.messages.blocksById) {
		if (!block.active) {
			continue;
		}
		summaryByBlockId.set(blockId, block);
	}

	return {
		rawMessages,
		rawMessagesById,
		rawIndexById,
		summaryByBlockId,
	};
}

/** Resolve start/end boundary ids (mNNNN or bN) into BoundaryReferences. */
export function resolveBoundaryIds(
	context: SearchContext,
	state: SessionState,
	startId: string,
	endId: string,
): { startReference: BoundaryReference; endReference: BoundaryReference } {
	const lookup = buildBoundaryLookup(context, state);
	const issues: string[] = [];
	const parsedStartId = parseBoundaryId(startId);
	const parsedEndId = parseBoundaryId(endId);

	if (parsedStartId === null) {
		issues.push("startId is invalid. Use an injected message ID (mNNNN) or block ID (bN).");
	}

	if (parsedEndId === null) {
		issues.push("endId is invalid. Use an injected message ID (mNNNN) or block ID (bN).");
	}

	if (issues.length > 0) {
		throw new Error(
			issues.length === 1 ? issues[0] : issues.map((issue) => `- ${issue}`).join("\n"),
		);
	}

	if (!parsedStartId || !parsedEndId) {
		throw new Error("Invalid boundary ID(s)");
	}

	const startReference = lookup.get(parsedStartId.ref);
	const endReference = lookup.get(parsedEndId.ref);

	if (!startReference || !endReference) {
		const messageRefs: string[] = [];
		const blockRefs: string[] = [];
		for (const ref of lookup.keys()) {
			if (ref.startsWith("b")) {
				blockRefs.push(ref);
			} else {
				messageRefs.push(ref);
			}
		}
		const recentMessages = messageRefs.slice(-12).join(", ");
		const activeBlocks = blockRefs.join(", ");

		const hasInvalidBlock =
			parsedStartId.kind === "compressed-block" || parsedEndId.kind === "compressed-block";
		const invalidBlockHint = hasInvalidBlock
			? " Note: bN blocks become unavailable after being nested into a newer compression; use an injected mNNNN or an active bN."
			: "";

		// Detect model hallucinating "the next message ref" (e.g. latest visible
		// ref is m0072 but model wrote m0073 intending "up to the latest"). Point
		// it at the actual max so it can self-correct in one retry without another
		// round-trip of guessing.
		const maxMessageRef = messageRefs.length > 0 ? messageRefs[messageRefs.length - 1] : null;
		const beyondMaxHint = (() => {
			if (!maxMessageRef) return "";
			const maxIndex = parseMessageRef(maxMessageRef);
			if (maxIndex === null) return "";
			const beyond: string[] = [];
			if (
				parsedStartId.kind === "message" &&
				parsedStartId.index > maxIndex &&
				!lookup.has(parsedStartId.ref)
			) {
				beyond.push(`startId ${parsedStartId.ref}`);
			}
			if (
				parsedEndId.kind === "message" &&
				parsedEndId.index > maxIndex &&
				!lookup.has(parsedEndId.ref)
			) {
				beyond.push(`endId ${parsedEndId.ref}`);
			}
			if (beyond.length === 0) return "";
			return ` ${beyond.join(" and ")} exceed${beyond.length === 1 ? "s" : ""} the latest available message ref (${maxMessageRef}); use startId/endId ≤ ${maxMessageRef}.`;
		})();

		issues.push(
			`Requested start=${parsedStartId.ref} end=${parsedEndId.ref} not in context.${invalidBlockHint}${beyondMaxHint} Active blocks: ${activeBlocks || "(none)"}. Recent messages (last 12): ${recentMessages || "(none — no compressible messages found)"}`,
		);
	}

	if (issues.length > 0) {
		throw new Error(
			issues.length === 1 ? issues[0] : issues.map((issue) => `- ${issue}`).join("\n"),
		);
	}

	if (!startReference || !endReference) {
		throw new Error("Failed to resolve boundary IDs");
	}

	if (startReference.rawIndex > endReference.rawIndex) {
		throw new Error(
			`startId ${parsedStartId.ref} appears after endId ${parsedEndId.ref} in the conversation. Start must come before end.`,
		);
	}

	return { startReference, endReference };
}

/** Resolve the message/tool ids and required nested block ids for a (start,end) pair. */
export function resolveSelection(
	context: SearchContext,
	startReference: BoundaryReference,
	endReference: BoundaryReference,
): SelectionResolution {
	const startRawIndex = startReference.rawIndex;
	const endRawIndex = endReference.rawIndex;
	const messageIds: string[] = [];
	const messageSeen = new Set<string>();
	const toolIds: string[] = [];
	const toolSeen = new Set<string>();
	const requiredBlockIds: number[] = [];
	const requiredBlockSeen = new Set<number>();
	const messageTokenById = new Map<string, number>();

	for (let index = startRawIndex; index <= endRawIndex; index++) {
		const rawMessage = context.rawMessages[index];
		if (!rawMessage) {
			continue;
		}
		if (isIgnoredUserMessage(rawMessage)) {
			continue;
		}

		const messageId = rawMessage.info.id;
		if (!messageSeen.has(messageId)) {
			messageSeen.add(messageId);
			messageIds.push(messageId);
		}

		if (!messageTokenById.has(messageId)) {
			messageTokenById.set(messageId, countAllMessageTokens(rawMessage));
		}

		const parts = Array.isArray(rawMessage.parts) ? rawMessage.parts : [];
		for (const part of parts) {
			if (part.type !== "tool" || !part.callID) {
				continue;
			}
			if (toolSeen.has(part.callID)) {
				continue;
			}
			toolSeen.add(part.callID);
			toolIds.push(part.callID);
		}
	}

	const selectedMessageIds = new Set(messageIds);
	const summariesInSelection: Array<{ blockId: number; rawIndex: number }> = [];
	for (const summary of context.summaryByBlockId.values()) {
		if (!selectedMessageIds.has(summary.anchorMessageId)) {
			continue;
		}

		const anchorIndex = context.rawIndexById.get(summary.anchorMessageId);
		if (anchorIndex === undefined) {
			continue;
		}

		summariesInSelection.push({
			blockId: summary.blockId,
			rawIndex: anchorIndex,
		});
	}

	summariesInSelection.sort((a, b) => a.rawIndex - b.rawIndex || a.blockId - b.blockId);
	for (const summary of summariesInSelection) {
		if (requiredBlockSeen.has(summary.blockId)) {
			continue;
		}
		requiredBlockSeen.add(summary.blockId);
		requiredBlockIds.push(summary.blockId);
	}

	if (messageIds.length === 0) {
		throw new Error(
			"Failed to map boundary matches back to raw messages. Choose boundaries that include original conversation messages.",
		);
	}

	return {
		startReference,
		endReference,
		messageIds,
		messageTokenById,
		toolIds,
		requiredBlockIds,
	};
}

/** Resolve the anchor message id for a given start reference. */
export function resolveAnchorMessageId(startReference: BoundaryReference): string {
	if (startReference.kind === "compressed-block") {
		if (!startReference.anchorMessageId) {
			throw new Error("Failed to map boundary matches back to raw messages");
		}
		return startReference.anchorMessageId;
	}

	if (!startReference.messageId) {
		throw new Error("Failed to map boundary matches back to raw messages");
	}
	return startReference.messageId;
}

/** Build the message-ref -> BoundaryReference and block-ref -> BoundaryReference maps. */
export function buildBoundaryLookup(
	context: SearchContext,
	state: SessionState,
): Map<string, BoundaryReference> {
	const lookup = new Map<string, BoundaryReference>();

	for (const [messageRef, messageId] of state.messageIds.byRef) {
		const rawMessage = context.rawMessagesById.get(messageId);
		if (!rawMessage) {
			continue;
		}
		if (isIgnoredUserMessage(rawMessage)) {
			continue;
		}

		const rawIndex = context.rawIndexById.get(messageId);
		if (rawIndex === undefined) {
			continue;
		}
		lookup.set(messageRef, {
			kind: "message",
			rawIndex,
			messageId,
		});
	}

	const summaries = Array.from(context.summaryByBlockId.values()).sort(
		(a, b) => a.blockId - b.blockId,
	);
	for (const summary of summaries) {
		const anchorMessage = context.rawMessagesById.get(summary.anchorMessageId);
		if (!anchorMessage) {
			continue;
		}
		if (isIgnoredUserMessage(anchorMessage)) {
			continue;
		}

		const rawIndex = context.rawIndexById.get(summary.anchorMessageId);
		if (rawIndex === undefined) {
			continue;
		}
		const blockRef = formatBlockRef(summary.blockId);
		if (!lookup.has(blockRef)) {
			lookup.set(blockRef, {
				kind: "compressed-block",
				rawIndex,
				blockId: summary.blockId,
				anchorMessageId: summary.anchorMessageId,
			});
		}
	}

	return lookup;
}
