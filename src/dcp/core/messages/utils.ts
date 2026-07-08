// SPDX-License-Identifier: AGPL-3.0-or-later
// Derived from opencode-dynamic-context-pruning v3.1.14 (https://github.com/Opencode-DCP/opencode-dynamic-context-pruning)
// Copyright (c) opencode-dcp contributors. Licensed under AGPL-3.0-or-later.

import type { SessionState, WithParts } from "../state-types.js";

export function buildToolIdList(state: SessionState, messages: WithParts[]): void {
	for (const msg of messages) {
		for (const part of msg.parts) {
			if (part.type === "tool" && part.callID) {
				state.toolIds.add(part.callID);
			}
		}
	}
}
