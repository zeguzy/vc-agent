// SPDX-License-Identifier: AGPL-3.0-or-later
// Derived from opencode-dynamic-context-pruning v3.1.14 (https://github.com/Opencode-DCP/opencode-dynamic-context-pruning)
// Copyright (c) opencode-dcp contributors. Licensed under AGPL-3.0-or-later.

import type { SessionState, WithParts } from "./state-types.js";

export function formatMessageRef(index: number): string {
	return `m${String(index + 1).padStart(4, "0")}`;
}

export function formatBlockRef(blockId: number): string {
	return `b${blockId}`;
}

export function parseMessageRef(ref: string): number | null {
	const match = /^m(\d+)$/.exec(ref);
	if (!match) return null;
	const num = Number.parseInt(match[1]!, 10);
	return Number.isNaN(num) ? null : num - 1;
}

export function parseBlockRef(ref: string): number | null {
	const match = /^b(\d+)$/.exec(ref);
	if (!match) return null;
	const num = Number.parseInt(match[1]!, 10);
	return Number.isNaN(num) ? null : num;
}

export function parseBoundaryId(id: string): {
	kind: "message" | "compressed-block";
	ref: string;
	index: number;
} | null {
	const msgIndex = parseMessageRef(id);
	if (msgIndex !== null) {
		return { kind: "message", ref: id, index: msgIndex };
	}
	const blockIdx = parseBlockRef(id);
	if (blockIdx !== null) {
		return { kind: "compressed-block", ref: id, index: blockIdx };
	}
	return null;
}

export function assignMessageRefs(state: SessionState, messages: WithParts[]): void {
	state.messageIds.byRef.clear();
	for (let i = 0; i < messages.length; i++) {
		const msg = messages[i];
		if (!msg) continue;
		const ref = formatMessageRef(i);
		if (!msg.info.id) {
			msg.info.id = ref;
		}
		state.messageIds.byRef.set(ref, msg.info.id);
	}
}
