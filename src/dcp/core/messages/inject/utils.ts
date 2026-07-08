// SPDX-License-Identifier: AGPL-3.0-or-later
// Derived from opencode-dynamic-context-pruning v3.1.14 (https://github.com/Opencode-DCP/opencode-dynamic-context-pruning)
// Copyright (c) opencode-dcp contributors. Licensed under AGPL-3.0-or-later.

import type { ContextPruningConfig } from "../../../config.js";
import { getDcpState } from "../../../config.js";
import type { AnchorType, SessionState } from "../../state-types.js";

export function getCurrentContextTokens(): number {
	const state = getDcpState();
	if (!state) return 0;
	return state.stats.pruneTokenCounter;
}

export function isContextOverLimits(config: ContextPruningConfig): {
	overMax: boolean;
	overMin: boolean;
} {
	const current = getCurrentContextTokens();
	const max = Number(config.compress?.maxContextLimit ?? 100000);
	const min = Number(config.compress?.minContextLimit ?? 50000);
	return {
		overMax: current >= max,
		overMin: current >= min,
	};
}

export function addAnchor(state: SessionState, type: AnchorType, interval: number): boolean {
	const lastIdx = state.lastAnchorIndex.get(type) ?? -Infinity;
	const currentIdx = state.llmCallCount;
	if (currentIdx - lastIdx < interval) {
		return false;
	}
	state.anchors.add(type);
	state.lastAnchorIndex.set(type, currentIdx);
	return true;
}

export function clearAnchors(state: SessionState): void {
	state.anchors.clear();
}
