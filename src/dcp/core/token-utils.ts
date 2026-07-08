// SPDX-License-Identifier: AGPL-3.0-or-later
// Derived from opencode-dynamic-context-pruning v3.1.14 (https://github.com/Opencode-DCP/opencode-dynamic-context-pruning)
// Copyright (c) opencode-dcp contributors. Licensed under AGPL-3.0-or-later.

import type { WithParts } from "./state-types.js";

const CHARS_PER_TOKEN = 4;

export function countTokens(text: string): number {
	if (!text) return 0;
	return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function countAllMessageTokens(msg: WithParts): number {
	let totalChars = 0;
	for (const part of msg.parts) {
		if (part.text) {
			totalChars += part.text.length;
		}
		if (part.output) {
			totalChars += part.output.length;
		}
	}
	return Math.ceil(totalChars / CHARS_PER_TOKEN);
}
