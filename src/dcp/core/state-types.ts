// SPDX-License-Identifier: AGPL-3.0-or-later
// Derived from opencode-dynamic-context-pruning v3.1.14 (https://github.com/Opencode-DCP/opencode-dynamic-context-pruning)
// Copyright (c) opencode-dcp contributors. Licensed under AGPL-3.0-or-later.

// Stub — full upstream types pending DCP port completion.

export interface SessionState {
	prune: {
		messages: {
			activeBlockIds: Set<unknown>;
		};
	};
	stats: {
		totalPruneTokens: number;
		pruneTokenCounter: number;
	};
}
