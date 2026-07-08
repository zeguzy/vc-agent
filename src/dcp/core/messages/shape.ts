// SPDX-License-Identifier: AGPL-3.0-or-later
// Derived from opencode-dynamic-context-pruning v3.1.14 (https://github.com/Opencode-DCP/opencode-dynamic-context-pruning)
// Copyright (c) opencode-dcp contributors. Licensed under AGPL-3.0-or-later.

import type { WithParts } from "../state-types.js";

export function filterMessagesInPlace(messages: WithParts[]): void {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (!msg) {
			messages.splice(i, 1);
			continue;
		}
		const hasContent =
			msg.parts.length > 0 && msg.parts.some((p) => p.text || p.output || p.callID);
		if (!hasContent) {
			messages.splice(i, 1);
		}
	}
}
