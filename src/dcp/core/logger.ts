// SPDX-License-Identifier: AGPL-3.0-or-later
// Derived from opencode-dynamic-context-pruning v3.1.14 (https://github.com/Opencode-DCP/opencode-dynamic-context-pruning)
// Copyright (c) opencode-dcp contributors. Licensed under AGPL-3.0-or-later.

export interface Logger {
	warn(msg: string, data?: Record<string, unknown>): void;
	info(msg: string, data?: Record<string, unknown>): void;
	debug(msg: string, data?: Record<string, unknown>): void;
}

type DiagInput = string | (() => string);

export function dcpDiag(msg: DiagInput, data?: Record<string, unknown>): void {
	const text = typeof msg === "function" ? msg() : msg;
	if (data && Object.keys(data).length > 0) {
		console.warn(`[DCP] ${text}`, data);
	} else {
		console.warn(`[DCP] ${text}`);
	}
}

export const defaultLogger: Logger = {
	warn: (msg, data) => dcpDiag(msg, data),
	info: (msg, data) => dcpDiag(msg, data),
	debug: (msg, data) => dcpDiag(msg, data),
};
