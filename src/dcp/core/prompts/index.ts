// SPDX-License-Identifier: AGPL-3.0-or-later
// Derived from opencode-dynamic-context-pruning v3.1.14 (https://github.com/Opencode-DCP/opencode-dynamic-context-pruning)
// Copyright (c) opencode-dcp contributors. Licensed under AGPL-3.0-or-later.

export interface BundledPrompts {
	promptSnippet: string;
	promptGuidelines: string[];
	nudgeTemplates: {
		soft: string;
		strong: string;
		iteration: string;
	};
}

export function createBundledRuntimePrompts(): BundledPrompts {
	return {
		promptSnippet:
			"Use the compress tool to manage context. When conversation grows long, compress older sections into high-fidelity summaries.",
		promptGuidelines: [
			"Compress when you sense the context is getting long or has accumulated completed work",
			"Pick ranges that represent completed logical units (closed topics, finished tool calls, resolved research)",
			"Write summaries that preserve ALL technical details: file paths, function signatures, decisions, errors, outcomes",
			"Never compress actively needed context or work in progress",
		],
		nudgeTemplates: {
			soft: 'You operate in a context-constrained environment. Manage context continuously to avoid buildup and preserve retrieval quality. Efficient context management is paramount for your agentic performance.\n\nThe ONLY tool you have for context management is `compress`. `compress` transforms conversation content into dense, high-fidelity summaries.\n\nThink of compression as phase transitions: raw exploration becomes refined understanding. The original context served its purpose; your summary now carries that understanding forward.\n\nCOMPRESS WHEN\n\nA section is genuinely closed and the raw conversation has served its purpose:\n- Research concluded and findings are clear\n- Implementation finished and verified\n- Exploration exhausted and patterns understood\n- Dead-end noise can be discarded without waiting for a whole chapter to close\n\nDO NOT COMPRESS IF\n\n- Raw context is still relevant and needed for edits or precise references\n- The target content is still actively in progress\n- You may need exact code, error messages, or file contents in the immediate next steps\n\nBefore compressing, ask: "Is this section closed enough to become summary-only right now?"\n\nEvaluate conversation signal-to-noise REGULARLY. Use `compress` deliberately with quality-first summaries. Prioritize stale content intelligently to maintain a high-signal context window that supports your agency.\n\nIt is of your responsibility to keep a sharp, high-quality context window for optimal performance.',
			strong:
				"WARNING: Context limit approaching. You MUST compress now.\n\nEvaluate conversation signal-to-noise and compress stale sections IMMEDIATELY. This is not optional — without compression, you will lose the ability to process new information.\n\nPrioritize: oldest completed work first. Compress research findings, finished tool calls, and resolved investigation threads. Preserve active context and work-in-progress.",
			iteration:
				"You've been working on this task for many iterations. Consider whether older exploration, failed attempts, or completed sub-tasks could be compressed to free up context for the remaining work.",
		},
	};
}
