// SPDX-License-Identifier: AGPL-3.0-or-later
// Derived from opencode-dynamic-context-pruning v3.1.14 (https://github.com/Opencode-DCP/opencode-dynamic-context-pruning)
// Copyright (c) opencode-dcp contributors. Licensed under AGPL-3.0-or-later.

/**
 * Compress tool pipeline + pi tool factories.
 *
 * Replaces upstream lib/compress/{range,message}.ts toolCtx.ask permission flow
 * and client.session.messages coupling. Permission is honored via state.compressPermission
 * (vc-agent has no permission UI; config "ask" is treated as "allow" per config.ts).
 * Message access uses the closure snapshot injected by extension.ts (D5).
 */

import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { type AgentMessage, toDcpMessages } from "../adapter.js";
import type { ContextPruningConfig } from "../config.js";
import { type CompressNotificationSummary, getCompressNotifier, isDcpEnabled } from "../config.js";
import {
	formatIssues as formatMessageIssues,
	formatResult as formatMessageResult,
	resolveMessages,
	validateArgs as validateMessageArgs,
} from "../core/compress/message-utils.js";
import {
	appendMissingBlockSummaries,
	injectBlockPlaceholders,
	parseBlockPlaceholders,
	resolveRanges,
	validateNonOverlapping,
	validateArgs as validateRangeArgs,
	validateSummaryPlaceholders,
} from "../core/compress/range-utils.js";
import { buildBoundaryLookup, buildSearchContext } from "../core/compress/search.js";
import type {
	AppliedCompressionResult,
	CompressionStateInput,
	CompressMessageToolArgs,
	CompressRangeToolArgs,
	SelectionResolution,
} from "../core/compress/types.js";
import { dcpDiag, type Logger } from "../core/logger.js";
import { assignMessageRefs } from "../core/message-ids.js";
import { filterMessagesInPlace } from "../core/messages/shape.js";
import { buildToolIdList } from "../core/messages/utils.js";
import { createBundledRuntimePrompts } from "../core/prompts/index.js";
import {
	allocateBlockId,
	allocateRunId,
	applyCompressionState,
	wrapCompressedSummary,
} from "../core/state/index.js";
import { saveSessionState } from "../core/state/persistence.js";
import type { SessionState, WithParts } from "../core/state-types.js";
import { countTokens } from "../core/token-utils.js";

const prompts = createBundledRuntimePrompts();
void prompts;

export type GetMessages = () => AgentMessage[];

export interface CompressToolDeps {
	state: SessionState;
	config: ContextPruningConfig;
	logger: Logger;
	getMessages: GetMessages;
}

const RANGE_TOOL_PARAMS = Type.Object({
	topic: Type.String({ description: "High-level topic shared by every range in this batch." }),
	content: Type.Array(
		Type.Object({
			startId: Type.String({ description: "mNNNN ref of the first message in the range." }),
			endId: Type.String({ description: "mNNNN ref of the last message in the range." }),
			summary: Type.String({ description: "Detailed summary replacing the range." }),
		}),
		{ minItems: 1 },
	),
});

const MESSAGE_TOOL_PARAMS = Type.Object({
	topic: Type.String({ description: "High-level topic shared by every entry in this batch." }),
	content: Type.Array(
		Type.Object({
			messageId: Type.String({ description: "mNNNN ref of the message to compress." }),
			topic: Type.String({ description: "Topic for this individual message." }),
			summary: Type.String({ description: "Detailed summary replacing the message." }),
		}),
		{ minItems: 1 },
	),
});

export function createCompressRangeTool(deps: CompressToolDeps): ToolDefinition {
	return {
		name: "compress",
		label: "Compress Range",
		description: "Compress one or more contiguous conversation ranges into summaries.",
		promptSnippet: "Collapse selected message ranges into detailed summaries.",
		promptGuidelines: [
			"Use compress to free up context only after the work in a range is superseded.",
		],
		parameters: RANGE_TOOL_PARAMS,
		execute: async (toolCallId, params) => {
			return executeRange(toolCallId, params as CompressRangeToolArgs, deps);
		},
	};
}

export function createCompressMessageTool(deps: CompressToolDeps): ToolDefinition {
	return {
		name: "compress",
		label: "Compress Messages",
		description: "Compress selected individual messages into per-message summaries.",
		promptSnippet: "Collapse selected individual messages into detailed summaries.",
		promptGuidelines: [
			"Use compress to free up context only after the work in a message is superseded.",
		],
		parameters: MESSAGE_TOOL_PARAMS,
		execute: async (toolCallId, params) => {
			return executeMessage(toolCallId, params as CompressMessageToolArgs, deps);
		},
	};
}

export function createCompressTool(deps: CompressToolDeps): ToolDefinition {
	return deps.config.compress.mode === "message"
		? createCompressMessageTool(deps)
		: createCompressRangeTool(deps);
}

async function executeRange(
	toolCallId: string,
	args: CompressRangeToolArgs,
	deps: CompressToolDeps,
): Promise<{ content: Array<{ type: "text"; text: string }>; details: unknown }> {
	if (!isDcpEnabled(deps.config)) {
		dcpDiag("compress:range blocked (DCP disabled)");
		return textResult("DCP is currently disabled. Enable it via /dcp on.");
	}
	validateRangeArgs(args);
	dcpDiag("compress:range called", {
		entries: args.content.length,
		topic: args.topic,
		firstStart: args.content[0]?.startId,
		firstEnd: args.content[0]?.endId,
	});
	try {
		return await doExecuteRange(toolCallId, args, deps);
	} catch (e) {
		const err = e instanceof Error ? e : new Error(String(e));
		dcpDiag("compress:range ERROR", {
			message: err.message,
			stack: err.stack?.split("\n").slice(0, 5).join(" | "),
		});
		return textResult(`DCP compress failed: ${err.message}`);
	}
}

async function doExecuteRange(
	toolCallId: string,
	args: CompressRangeToolArgs,
	deps: CompressToolDeps,
): Promise<{ content: Array<{ type: "text"; text: string }>; details: unknown }> {
	const { state, logger, getMessages } = deps;
	const dcp = snapshotToDcp(state, getMessages());
	dcpDiag("range: snapshot", { msgs: dcp.length });
	if (dcp.length === 0) {
		return textResult("No compressible messages available in the current context.");
	}

	const searchContext = buildSearchContext(state, dcp);
	const lookup = buildBoundaryLookup(searchContext, state);
	dcpDiag("range: lookup", {
		byRefTail: [...state.messageIds.byRef.keys()].slice(-6),
		lookupTail: [...lookup.keys()].slice(-6),
		dcpCount: dcp.length,
	});
	const plans = resolveRanges(args, searchContext, state);
	dcpDiag("range: resolved", { plans: plans.length });
	validateNonOverlapping(plans);

	if (state.compressPermission === "deny") {
		return textResult("Compression is denied in this session.");
	}

	const runId = allocateRunId(state);
	const compressMessageId = `compress_msg_${toolCallId}`;
	let totalCompressed = 0;
	let totalSummaryTokens = 0;
	const messageIds = new Set<string>();
	const toolIds = new Set<string>();
	const summaries: string[] = [];

	for (const plan of plans) {
		const blockId = allocateBlockId(state);
		const requiredBlockIds = plan.selection.requiredBlockIds;
		const placeholders = parseBlockPlaceholders(plan.entry.summary);
		const missingIds = validateSummaryPlaceholders(
			placeholders,
			requiredBlockIds,
			plan.selection.startReference,
			plan.selection.endReference,
			searchContext.summaryByBlockId,
		);
		const injected = injectBlockPlaceholders(
			plan.entry.summary,
			placeholders,
			searchContext.summaryByBlockId,
			plan.selection.startReference,
			plan.selection.endReference,
		);
		const finalSummary = appendMissingBlockSummaries(
			injected.expandedSummary,
			missingIds,
			searchContext.summaryByBlockId,
			injected.consumedBlockIds,
		);
		const wrapped = wrapCompressedSummary(blockId, finalSummary.expandedSummary);

		const input: CompressionStateInput = {
			topic: args.topic,
			batchTopic: args.topic,
			startId: plan.entry.startId,
			endId: plan.entry.endId,
			mode: "range",
			runId,
			compressMessageId,
			compressCallId: toolCallId,
			summaryTokens: countTokens(wrapped),
		};

		const result: AppliedCompressionResult = applyCompressionState(
			state,
			input,
			plan.selection,
			plan.anchorMessageId,
			blockId,
			wrapped,
			finalSummary.consumedBlockIds,
		);
		totalCompressed += result.compressedTokens;
		totalSummaryTokens += input.summaryTokens;
		for (const mid of result.newlyCompressedMessageIds) messageIds.add(mid);
		for (const tid of result.newlyCompressedToolIds) toolIds.add(tid);
		summaries.push(
			`b${blockId} (${plan.entry.startId}..${plan.entry.endId}): ${result.compressedTokens} tokens`,
		);
	}

	await persistAndNotify(state, logger);
	emitCompressNotification(
		{
			messageCount: messageIds.size,
			toolCount: toolIds.size,
			savedTokens: totalCompressed,
			summaryTokens: totalSummaryTokens,
			runId,
			topic: args.topic,
		},
		deps,
	);

	dcpDiag("compress:range done", {
		blocks: summaries.length,
		msgs: messageIds.size,
		tools: toolIds.size,
		tokens: totalCompressed,
	});
	return textResult(
		`Compressed ${plans.length} range(s) into ${summaries.length} summary block(s). Saved ~${totalCompressed} tokens.\n${summaries.join("\n")}`,
		{ planCount: plans.length, totalCompressed, runId, compressMessageId },
	);
}

async function executeMessage(
	toolCallId: string,
	args: CompressMessageToolArgs,
	deps: CompressToolDeps,
): Promise<{ content: Array<{ type: "text"; text: string }>; details: unknown }> {
	const { state, config, logger, getMessages } = deps;
	if (!isDcpEnabled(config)) {
		dcpDiag("compress:message blocked (DCP disabled)");
		return textResult("DCP is currently disabled. Enable it via /dcp on.");
	}
	validateMessageArgs(args);
	dcpDiag("compress:message called", { entries: args.content.length, topic: args.topic });

	const dcp = snapshotToDcp(state, getMessages());
	if (dcp.length === 0) {
		return textResult("No compressible messages available in the current context.");
	}

	const searchContext = buildSearchContext(state, dcp);
	const resolved = resolveMessages(args, searchContext, state, config);

	if (resolved.plans.length === 0) {
		return textResult(formatMessageIssues(resolved.skippedIssues, resolved.skippedCount));
	}

	if (state.compressPermission === "deny") {
		return textResult("Compression is denied in this session.");
	}

	const runId = allocateRunId(state);
	const compressMessageId = `compress_msg_${toolCallId}`;
	let totalCompressed = 0;
	let totalSummaryTokens = 0;
	const messageIds = new Set<string>();
	const toolIds = new Set<string>();

	for (const plan of resolved.plans) {
		const blockId = allocateBlockId(state);
		const wrapped = wrapCompressedSummary(blockId, plan.entry.summary);
		const input: CompressionStateInput = {
			topic: plan.entry.topic,
			batchTopic: args.topic,
			startId: plan.entry.messageId,
			endId: plan.entry.messageId,
			mode: "message",
			runId,
			compressMessageId,
			compressCallId: toolCallId,
			summaryTokens: countTokens(wrapped),
		};
		const result = applyCompressionState(
			state,
			input,
			plan.selection,
			plan.anchorMessageId,
			blockId,
			wrapped,
			[],
		);
		totalCompressed += result.compressedTokens;
		totalSummaryTokens += input.summaryTokens;
		for (const mid of result.newlyCompressedMessageIds) messageIds.add(mid);
		for (const tid of result.newlyCompressedToolIds) toolIds.add(tid);
	}

	await persistAndNotify(state, logger);
	emitCompressNotification(
		{
			messageCount: messageIds.size,
			toolCount: toolIds.size,
			savedTokens: totalCompressed,
			summaryTokens: totalSummaryTokens,
			runId,
			topic: args.topic,
		},
		deps,
	);

	dcpDiag("compress:message done", {
		processed: resolved.plans.length,
		skipped: resolved.skippedCount,
		tokens: totalCompressed,
	});
	return textResult(
		formatMessageResult(resolved.plans.length, resolved.skippedIssues, resolved.skippedCount),
		{ processed: resolved.plans.length, skipped: resolved.skippedCount, totalCompressed, runId },
	);
}

function snapshotToDcp(state: SessionState, messages: AgentMessage[]): WithParts[] {
	const dcp = toDcpMessages(messages, state.sessionId ?? "unknown");
	filterMessagesInPlace(dcp);
	assignMessageRefs(state, dcp);
	buildToolIdList(state, dcp);
	return dcp;
}

async function persistAndNotify(state: SessionState, logger: Logger): Promise<void> {
	try {
		await saveSessionState(state, logger);
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		logger.warn("DCP compress: failed to persist state", { error: msg });
	}
}

function emitCompressNotification(
	partial: Omit<CompressNotificationSummary, "summary">,
	deps: CompressToolDeps,
): void {
	if (deps.config.pruneNotification === "off") return;
	const notifier = getCompressNotifier();
	if (!notifier) return;
	let summary: string | undefined;
	if (deps.config.compress.showCompression && deps.config.pruneNotification === "detailed") {
		const parts: string[] = [];
		for (const id of deps.state.prune.messages.activeBlockIds) {
			const block = deps.state.prune.messages.blocksById.get(id);
			if (block && block.runId === partial.runId) {
				parts.push(block.summary);
			}
		}
		if (parts.length > 0) summary = parts.join("\n\n");
	}
	notifier({ ...partial, summary });
}

function textResult(
	text: string,
	details?: Record<string, unknown>,
): {
	content: Array<{ type: "text"; text: string }>;
	details: unknown;
} {
	return {
		content: [{ type: "text", text }],
		details: details ?? {},
	};
}

/** Prepare-session helper kept for symmetry with upstream; vc-agent runs strategies inline. */
export function prepareSession(state: SessionState, messages: WithParts[]): void {
	assignMessageRefs(state, messages);
	buildToolIdList(state, messages);
}

/** Finalize-session helper: persist state + log summary. Notification UI is task 10. */
export async function finalizeSession(state: SessionState, logger: Logger): Promise<void> {
	await persistAndNotify(state, logger);
}

export function directCompressMessages(
	deps: CompressToolDeps,
	opts: { keepRecent?: number; topic?: string },
): { compressed: number; tokens: number; error?: string } {
	const { state, logger, getMessages } = deps;
	if (!isDcpEnabled(deps.config)) {
		return { compressed: 0, tokens: 0, error: "DCP disabled" };
	}
	const keepRecent = opts.keepRecent ?? 4;
	const topic = opts.topic?.trim() || "direct-compress";
	try {
		const dcp = toDcpMessages(getMessages(), state.sessionId ?? "unknown");
		filterMessagesInPlace(dcp);
		if (dcp.length <= keepRecent) {
			dcpDiag("direct: too few messages", { msgs: dcp.length, keepRecent });
			return {
				compressed: 0,
				tokens: 0,
				error: `only ${dcp.length} messages (need >${keepRecent})`,
			};
		}
		const compressible = dcp.slice(0, dcp.length - keepRecent);
		const ids = compressible
			.map((m) => m.info.id)
			.filter((id): id is string => typeof id === "string" && id.length > 0);
		if (ids.length === 0) {
			dcpDiag("direct: no valid ids", { msgs: compressible.length });
			return { compressed: 0, tokens: 0, error: "no compressible messages with ids" };
		}
		const firstId = ids[0]!;
		const lastId = ids[ids.length - 1]!;
		const anchorId = compressible[0]!.info.id ?? firstId;

		const summaryText = compressible
			.map((m) => {
				const t = m.parts.find((p) => p.type === "text")?.text;
				return t ? `[${m.info.role}] ${t.slice(0, 180)}` : null;
			})
			.filter(Boolean)
			.join("\n")
			.slice(0, 1800);

		const blockId = allocateBlockId(state);
		const runId = allocateRunId(state);
		const wrapped = wrapCompressedSummary(blockId, summaryText);

		const selection: SelectionResolution = {
			startReference: { kind: "message", rawIndex: 0, messageId: firstId },
			endReference: { kind: "message", rawIndex: compressible.length - 1, messageId: lastId },
			messageIds: ids,
			messageTokenById: new Map(ids.map((id) => [id, 100])),
			toolIds: [],
			requiredBlockIds: [],
		};
		const input: CompressionStateInput = {
			topic,
			batchTopic: topic,
			startId: firstId,
			endId: lastId,
			mode: "range",
			runId,
			compressMessageId: `direct_${Date.now()}`,
			summaryTokens: countTokens(wrapped),
		};

		const result = applyCompressionState(state, input, selection, anchorId, blockId, wrapped, []);
		dcpDiag("direct: applied", { blockId, msgs: ids.length, tokens: result.compressedTokens });

		persistAndNotify(state, logger).catch(() => {});
		emitCompressNotification(
			{
				messageCount: ids.length,
				toolCount: 0,
				savedTokens: result.compressedTokens,
				summaryTokens: input.summaryTokens,
				runId,
				topic,
			},
			deps,
		);
		return { compressed: ids.length, tokens: result.compressedTokens };
	} catch (e) {
		const err = e instanceof Error ? e : new Error(String(e));
		dcpDiag("direct: ERROR", { message: err.message });
		return { compressed: 0, tokens: 0, error: err.message };
	}
}
