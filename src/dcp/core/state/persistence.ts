// SPDX-License-Identifier: AGPL-3.0-or-later
// Derived from opencode-dynamic-context-pruning v3.1.14 (https://github.com/Opencode-DCP/opencode-dynamic-context-pruning)
// Copyright (c) opencode-dcp contributors. Licensed under AGPL-3.0-or-later.

import { setDcpState } from "../../config.js";
import type { Logger } from "../logger.js";
import type { SessionState } from "../state-types.js";

export async function saveSessionState(state: SessionState, _logger: Logger): Promise<void> {
	setDcpState(state);
}
