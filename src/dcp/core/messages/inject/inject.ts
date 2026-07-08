// SPDX-License-Identifier: AGPL-3.0-or-later
// Derived from opencode-dynamic-context-pruning v3.1.14 (https://github.com/Opencode-DCP/opencode-dynamic-context-pruning)
// Copyright (c) opencode-dcp contributors. Licensed under AGPL-3.0-or-later.

import type { ContextPruningConfig } from "../../../config.js";
import { getDcpState } from "../../../config.js";
import { createBundledRuntimePrompts } from "../../prompts/index.js";
import type { SessionState, WithParts } from "../../state-types.js";
import { addAnchor, clearAnchors, isContextOverLimits } from "./utils.js";

const SYSTEM_MARKER = "<dcp-nudge>";

export function injectNudges(
	messages: WithParts[],
	context: { config: ContextPruningConfig; state: SessionState },
): WithParts[] {
	const { config, state } = context;

	state.llmCallCount++;

	if (!config.compress) {
		return messages;
	}

	const { overMax, overMin } = isContextOverLimits(config);
	const prompts = createBundledRuntimePrompts();
	const result = [...messages];

	if (!overMin) {
		clearAnchors(state);
		return result;
	}

	if (overMax) {
		const recentCompress = hasRecentCompress(result, 3);
		if (recentCompress) {
			return result;
		}
		if (addAnchor(state, "context-limit", config.compress.nudgeFrequency ?? 5)) {
			result.push(makeNudgeMessage(prompts.nudgeTemplates.strong));
		}
		return result;
	}

	const lastUserIdx = findLastUserIndex(result);
	const isTurnBoundary =
		lastUserIdx !== -1 && state.lastUserMessageIndex !== lastUserIdx && lastUserIdx < result.length;

	if (isTurnBoundary) {
		state.lastUserMessageIndex = lastUserIdx;
		const force = config.compress.nudgeForce ?? "soft";
		const template =
			force === "strong" ? prompts.nudgeTemplates.strong : prompts.nudgeTemplates.soft;
		if (addAnchor(state, "turn-boundary", 1)) {
			result.splice(lastUserIdx + 1, 0, makeNudgeMessage(template));
		}
	}

	const threshold = config.compress.iterationNudgeThreshold ?? 15;
	const messagesSinceUser = lastUserIdx >= 0 ? result.length - lastUserIdx - 1 : result.length;
	if (messagesSinceUser >= threshold) {
		if (addAnchor(state, "iteration", config.compress.nudgeFrequency ?? 5)) {
			result.push(makeNudgeMessage(prompts.nudgeTemplates.iteration));
		}
	}

	return result;
}

function makeNudgeMessage(text: string): WithParts {
	return {
		info: {
			id: `dcp-nudge-${Date.now()}`,
			role: "user",
		},
		parts: [{ type: "text", text: `${SYSTEM_MARKER}\n${text}` }],
	};
}

function findLastUserIndex(messages: WithParts[]): number {
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i]?.info.role === "user") return i;
	}
	return -1;
}

function hasRecentCompress(messages: WithParts[], count: number): boolean {
	const recent = messages.slice(-count);
	return recent.some((m) =>
		m.parts.some(
			(p) => p.type === "tool" && (p.name === "compress" || p.callID?.includes("compress")),
		),
	);
}

export { getDcpState };
