// SPDX-License-Identifier: AGPL-3.0-or-later
// Derived from opencode-dynamic-context-pruning v3.1.14 (https://github.com/Opencode-DCP/opencode-dynamic-context-pruning)
// Copyright (c) opencode-dcp contributors. Licensed under AGPL-3.0-or-later.

import type { WithParts } from "../state-types.js";

const SYSTEM_MARKERS = ["<system", "<dcp", "<system-reminder", "<dcp-message-id"];

export function isIgnoredUserMessage(msg: WithParts): boolean {
	if (msg.info.role !== "user") return false;
	for (const part of msg.parts) {
		if (part.text) {
			const trimmed = part.text.trimStart();
			if (SYSTEM_MARKERS.some((marker) => trimmed.startsWith(marker))) {
				return true;
			}
		}
	}
	return false;
}

export function findMessageById(messages: WithParts[], id: string): WithParts | undefined {
	return messages.find((m) => m.info.id === id);
}

export function getMessageRange(
	messages: WithParts[],
	startId: string,
	endId: string,
): WithParts[] {
	const startIdx = messages.findIndex((m) => m.info.id === startId);
	const endIdx = messages.findIndex((m) => m.info.id === endId);
	if (startIdx === -1 || endIdx === -1 || startIdx > endIdx) return [];
	return messages.slice(startIdx, endIdx + 1);
}
