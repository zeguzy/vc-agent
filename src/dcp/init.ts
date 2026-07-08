// SPDX-License-Identifier: AGPL-3.0-or-later
// Derived from opencode-dynamic-context-pruning v3.1.14 (https://github.com/Opencode-DCP/opencode-dynamic-context-pruning)
// Copyright (c) opencode-dcp contributors. Licensed under AGPL-3.0-or-later.

import type { AgentSession, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { AgentMessage } from "./adapter.js";
import { createCompressTool } from "./compress/pipeline.js";
import {
	type CompressNotificationSummary,
	type ContextPruningUserConfig,
	getDcpConfig,
	isDcpEnabled,
	resolveContextPruningConfig,
	setCompressNotifier,
	setDcpConfig,
	setDcpState,
} from "./config.js";
import { defaultLogger } from "./core/logger.js";
import { createSessionState, type SessionState } from "./core/state-types.js";
import { wrapTransformContext } from "./transform-wrap.js";

const messageGetterHolder: { fn: (() => AgentMessage[]) | null } = { fn: null };

export function prepareDcpExtension(
	userConfig?: ContextPruningUserConfig,
	notifier?: (summary: CompressNotificationSummary) => void,
): ToolDefinition | null {
	const config = resolveContextPruningConfig(userConfig);
	if (!isDcpEnabled(config)) {
		return null;
	}

	setDcpConfig(config);
	const state: SessionState = createSessionState();
	setDcpState(state);

	if (notifier) {
		setCompressNotifier(notifier);
	}

	return createCompressTool({
		state,
		config,
		logger: defaultLogger,
		getMessages: () => messageGetterHolder.fn?.() ?? [],
	});
}

export function activateDcpExtension(session: AgentSession): void {
	messageGetterHolder.fn = () => (session.agent.state.messages ?? []) as unknown as AgentMessage[];
	wrapTransformContext(session.agent, getDcpConfig());
}

export { getDcpConfig, isDcpEnabled };
