// SPDX-License-Identifier: AGPL-3.0-or-later
// Derived from opencode-dynamic-context-pruning v3.1.14 (https://github.com/Opencode-DCP/opencode-dynamic-context-pruning)
// Copyright (c) opencode-dcp contributors. Licensed under AGPL-3.0-or-later.

import type { ContextPruningConfig } from "../../config.js";
import type { SessionState } from "../state-types.js";
import { resolveBoundaryIds, resolveSelection } from "./search.js";
import type {
	CompressMessageToolArgs,
	MessagePlan,
	MessageResolutionResult,
	SearchContext,
} from "./types.js";

export function validateArgs(args: CompressMessageToolArgs): void {
	if (!args.topic || typeof args.topic !== "string") {
		throw new Error("compress message: topic is required");
	}
	if (!Array.isArray(args.content) || args.content.length === 0) {
		throw new Error("compress message: content must be a non-empty array");
	}
	for (const entry of args.content) {
		if (!entry.messageId || !entry.summary) {
			throw new Error("compress message: each entry requires messageId and summary");
		}
	}
}

export function resolveMessages(
	args: CompressMessageToolArgs,
	context: SearchContext,
	state: SessionState,
	_config: ContextPruningConfig,
): MessageResolutionResult {
	const plans: MessagePlan[] = [];
	const skippedIssues: string[] = [];
	let skippedCount = 0;

	for (const entry of args.content) {
		const parsed = context.rawMessagesById.get(entry.messageId);
		if (!parsed) {
			skippedIssues.push(`Message ${entry.messageId} not found`);
			skippedCount++;
			continue;
		}

		const { startReference, endReference } = resolveBoundaryIds(
			context,
			state,
			entry.messageId,
			entry.messageId,
		);
		const selection = resolveSelection(context, startReference, endReference);
		const anchorMessageId = entry.messageId;

		plans.push({ entry, selection, anchorMessageId });
	}

	return { plans, skippedIssues, skippedCount };
}

export function formatIssues(issues: string[], skippedCount: number): string {
	if (issues.length === 0) return "";
	const header = `${skippedCount} message(s) skipped:`;
	return `${header}\n${issues.map((i) => `  - ${i}`).join("\n")}`;
}

export function formatResult(processed: number, issues: string[], skippedCount: number): string {
	const parts: string[] = [`Compressed ${processed} message(s).`];
	if (skippedCount > 0) {
		parts.push(formatIssues(issues, skippedCount));
	}
	return parts.join("\n");
}
