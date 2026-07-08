// SPDX-License-Identifier: AGPL-3.0-or-later
// Derived from opencode-dynamic-context-pruning v3.1.14 (https://github.com/Opencode-DCP/opencode-dynamic-context-pruning)
// Copyright (c) opencode-dcp contributors. Licensed under AGPL-3.0-or-later.

import type { Agent } from "@earendil-works/pi-agent-core";
import { toDcpMessages } from "./adapter.js";
import type { ContextPruningConfig } from "./config.js";
import { getDcpState } from "./config.js";
import { dcpDiag } from "./core/logger.js";
import { injectNudges } from "./core/messages/inject/inject.js";

export function wrapTransformContext(agent: Agent, config: ContextPruningConfig): void {
	const original = agent.transformContext;
	if (!original) {
		dcpDiag("agent.transformContext not found, skipping DCP wrap");
		return;
	}

	agent.transformContext = async (messages, signal) => {
		try {
			const state = getDcpState();
			if (!state) {
				return original.call(agent, messages, signal);
			}

			const dcpMessages = toDcpMessages(
				messages as unknown as Array<{ role: string; content: unknown }>,
				state.sessionId ?? "unknown",
			);
			const injected = injectNudges(dcpMessages, { config, state });

			if (injected.length === dcpMessages.length) {
				return original.call(agent, messages, signal);
			}

			const enriched = [...messages];
			for (let i = dcpMessages.length; i < injected.length; i++) {
				const msg = injected[i];
				if (!msg) continue;
				const text = msg.parts.map((p) => p.text ?? "").join("\n");
				enriched.push({
					role: "user",
					content: [{ type: "text", text }],
				} as unknown as (typeof messages)[number]);
			}

			return original.call(agent, enriched, signal);
		} catch (err) {
			dcpDiag(() => `transformContext wrap error, falling back: ${String(err)}`);
			return original.call(agent, messages, signal);
		}
	};
}
