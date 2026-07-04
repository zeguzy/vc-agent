// SPDX-License-Identifier: AGPL-3.0-or-later
// Derived from opencode-dynamic-context-pruning v3.1.14 (https://github.com/Opencode-DCP/opencode-dynamic-context-pruning)
// Copyright (c) opencode-dcp contributors. Licensed under AGPL-3.0-or-later.

/**
 * DCP (Dynamic Context Pruning) configuration.
 *
 * Ported from opencode-dcp's lib/config.ts defaults. Lives under the
 * `contextPruning` key of the vc-agent config.json (global ~/.config/openagent/
 * or project .openagent/), merged via the existing two-level deepMerge.
 */

import type { SessionState } from "./core/state-types.js";

export type CompressMode = "range" | "message";
export type CompressPermission = "allow" | "ask" | "deny";
export type NudgeForce = "strong" | "soft";
export type PruneNotificationLevel = "off" | "minimal" | "detailed";
export type PruneNotificationType = "chat" | "toast";

/**
 * Summary of a single compress-tool invocation, handed to the host (vc-agent)
 * so it can render a chat/toast notification in its own UI.
 *
 * Mirrors the verbatim fields needed to reproduce upstream
 * buildCompressNotificationText output (lib/ui/notification.ts).
 */
export interface CompressNotificationSummary {
	/** Distinct message ids collapsed by this compress call. */
	messageCount: number;
	/** Distinct tool ids collapsed by this compress call (0 when only text was compressed). */
	toolCount: number;
	/** Gross tokens removed from the context window. */
	savedTokens: number;
	/** Tokens occupied by the new summary block(s). */
	summaryTokens: number;
	/** Run id allocated for this batch (Compression #N label). */
	runId: number;
	/** Batch topic (compress tool args.topic), or "(unknown topic)" if unset. */
	topic?: string;
	/** Aggregated summary text when config.compress.showCompression is true. */
	summary?: string;
}

export interface CompressConfig {
	/** Compression mode: "range" (contiguous spans) or experimental "message" (per-message). */
	mode: CompressMode;
	/** Permission mode. vc-agent has no permission system, so "ask" is treated as "allow". */
	permission: CompressPermission;
	/** Show compression content in a chat notification. */
	showCompression: boolean;
	/** Let active summary tokens extend the effective maxContextLimit. */
	summaryBuffer: boolean;
	/** Soft upper threshold (tokens or "X%") above which strong nudges fire. */
	maxContextLimit: number | string;
	/** Soft lower threshold below which turn/iteration reminders are off. */
	minContextLimit: number | string;
	/** Per-model override for maxContextLimit by providerID/modelID. */
	modelMaxLimits?: Record<string, number | string>;
	/** Per-model override for minContextLimit. */
	modelMinLimits?: Record<string, number | string>;
	/** How often the context-limit nudge fires (1 = every fetch, 5 = every 5th). */
	nudgeFrequency: number;
	/** Start adding compression reminders after this many messages since last user message. */
	iterationNudgeThreshold: number;
	/** "strong" = more likely to compress after user messages, "soft" = less likely. */
	nudgeForce: NudgeForce;
	/** Tool names whose completed outputs are appended to the compression summary. */
	protectedTools: string[];
	/** Preserve text wrapped in <protect>...</protect> when compressed. */
	protectTags: boolean;
	/** Preserve user messages verbatim during compression. */
	protectUserMessages: boolean;
}

export interface DeduplicationConfig {
	enabled: boolean;
	protectedTools: string[];
}

export interface PurgeErrorsConfig {
	enabled: boolean;
	/** Number of turns before errored tool inputs are pruned. */
	turns: number;
	protectedTools: string[];
}

export interface StrategiesConfig {
	deduplication: DeduplicationConfig;
	purgeErrors: PurgeErrorsConfig;
}

export interface ManualModeConfig {
	enabled: boolean;
	/** When true, automatic cleanup (deduplication, purgeErrors) still runs in manual mode. */
	automaticStrategies: boolean;
}

export interface TurnProtectionConfig {
	enabled: boolean;
	turns: number;
}

export interface CommandsConfig {
	enabled: boolean;
	protectedTools: string[];
}

export interface DcpExperimentalConfig {
	/** Allow DCP processing in subagent sessions. */
	allowSubAgents: boolean;
	/** Enable user-editable prompt overrides. */
	customPrompts: boolean;
}

export interface ContextPruningUserConfig {
	/** Master switch. Default false — opt-in. When false, no DCP extension is injected. */
	enabled?: boolean;
	/** Debug logging. */
	debug?: boolean;
	/** Notification verbosity. */
	pruneNotification?: PruneNotificationLevel;
	/** Notification delivery channel. */
	pruneNotificationType?: PruneNotificationType;
	commands?: Partial<CommandsConfig>;
	manualMode?: Partial<ManualModeConfig>;
	turnProtection?: Partial<TurnProtectionConfig>;
	experimental?: Partial<DcpExperimentalConfig>;
	/** Glob patterns protecting file operations from pruning. */
	protectedFilePatterns?: string[];
	compress?: Partial<CompressConfig>;
	strategies?: {
		deduplication?: Partial<DeduplicationConfig>;
		purgeErrors?: Partial<PurgeErrorsConfig>;
	};
}

/** Fully-resolved config after applying defaults. */
export interface ContextPruningConfig
	extends Omit<
		ContextPruningUserConfig,
		"compress" | "strategies" | "commands" | "manualMode" | "turnProtection" | "experimental"
	> {
	enabled: boolean;
	debug: boolean;
	pruneNotification: PruneNotificationLevel;
	pruneNotificationType: PruneNotificationType;
	commands: CommandsConfig;
	manualMode: ManualModeConfig;
	turnProtection: TurnProtectionConfig;
	experimental: DcpExperimentalConfig;
	protectedFilePatterns: string[];
	compress: CompressConfig;
	strategies: StrategiesConfig;
}

export const DEFAULT_CONTEXT_PRUNING: ContextPruningConfig = {
	enabled: false,
	debug: false,
	pruneNotification: "off",
	pruneNotificationType: "toast",
	commands: { enabled: true, protectedTools: [] },
	manualMode: { enabled: false, automaticStrategies: true },
	turnProtection: { enabled: false, turns: 4 },
	experimental: { allowSubAgents: false, customPrompts: false },
	protectedFilePatterns: [],
	compress: {
		mode: "range",
		permission: "allow",
		showCompression: false,
		summaryBuffer: true,
		maxContextLimit: 100000,
		minContextLimit: 50000,
		nudgeFrequency: 5,
		iterationNudgeThreshold: 15,
		nudgeForce: "soft",
		protectedTools: ["task", "skill", "todowrite", "todoread"],
		protectTags: false,
		protectUserMessages: false,
	},
	strategies: {
		deduplication: { enabled: true, protectedTools: [] },
		purgeErrors: { enabled: true, turns: 4, protectedTools: [] },
	},
};

/** Tools always protected from pruning (DCP default). */
export const DEFAULT_PROTECTED_TOOLS = [
	"task",
	"skill",
	"todowrite",
	"todoread",
	"compress",
	"batch",
	"plan_enter",
	"plan_exit",
	"write",
	"edit",
];

/** Resolve a partial user config into a fully-defaulted config. */
export function resolveContextPruningConfig(user?: ContextPruningUserConfig): ContextPruningConfig {
	if (!user) return structuredClone(DEFAULT_CONTEXT_PRUNING);
	return {
		enabled: user.enabled ?? DEFAULT_CONTEXT_PRUNING.enabled,
		debug: user.debug ?? DEFAULT_CONTEXT_PRUNING.debug,
		pruneNotification: user.pruneNotification ?? DEFAULT_CONTEXT_PRUNING.pruneNotification,
		pruneNotificationType:
			user.pruneNotificationType ?? DEFAULT_CONTEXT_PRUNING.pruneNotificationType,
		commands: {
			enabled: user.commands?.enabled ?? DEFAULT_CONTEXT_PRUNING.commands.enabled,
			protectedTools:
				user.commands?.protectedTools ?? DEFAULT_CONTEXT_PRUNING.commands.protectedTools,
		},
		manualMode: {
			enabled: user.manualMode?.enabled ?? DEFAULT_CONTEXT_PRUNING.manualMode.enabled,
			automaticStrategies:
				user.manualMode?.automaticStrategies ??
				DEFAULT_CONTEXT_PRUNING.manualMode.automaticStrategies,
		},
		turnProtection: {
			enabled: user.turnProtection?.enabled ?? DEFAULT_CONTEXT_PRUNING.turnProtection.enabled,
			turns: user.turnProtection?.turns ?? DEFAULT_CONTEXT_PRUNING.turnProtection.turns,
		},
		experimental: {
			allowSubAgents:
				user.experimental?.allowSubAgents ?? DEFAULT_CONTEXT_PRUNING.experimental.allowSubAgents,
			customPrompts:
				user.experimental?.customPrompts ?? DEFAULT_CONTEXT_PRUNING.experimental.customPrompts,
		},
		protectedFilePatterns:
			user.protectedFilePatterns ?? DEFAULT_CONTEXT_PRUNING.protectedFilePatterns,
		compress: { ...DEFAULT_CONTEXT_PRUNING.compress, ...user.compress },
		strategies: {
			deduplication: {
				...DEFAULT_CONTEXT_PRUNING.strategies.deduplication,
				...user.strategies?.deduplication,
			},
			purgeErrors: {
				...DEFAULT_CONTEXT_PRUNING.strategies.purgeErrors,
				...user.strategies?.purgeErrors,
			},
		},
	};
}

let _runtimeEnabledOverride: boolean | undefined;

export function setDcpRuntimeEnabled(value: boolean): void {
	_runtimeEnabledOverride = value;
}

export function isDcpEnabled(fallback: ContextPruningConfig): boolean {
	return _runtimeEnabledOverride ?? fallback.enabled;
}

let _dcpConfig: ContextPruningConfig | undefined;

export function setDcpConfig(config: ContextPruningConfig): void {
	_dcpConfig = config;
}

export function getDcpConfig(): ContextPruningConfig {
	return _dcpConfig ?? DEFAULT_CONTEXT_PRUNING;
}

let _directCompressFn:
	| ((opts: { keepRecent?: number; topic?: string }) => {
			compressed: number;
			tokens: number;
			error?: string;
	  })
	| undefined;

export function setDirectCompressFn(
	fn:
		| ((opts: { keepRecent?: number; topic?: string }) => {
				compressed: number;
				tokens: number;
				error?: string;
		  })
		| undefined,
): void {
	_directCompressFn = fn;
}

export function triggerDirectCompress(opts: { keepRecent?: number; topic?: string }): {
	compressed: number;
	tokens: number;
	error?: string;
} {
	if (!_directCompressFn) {
		return { compressed: 0, tokens: 0, error: "DCP extension not loaded" };
	}
	return _directCompressFn(opts);
}

// --- Host bridge holders ---------------------------------------------------
// Module-level holders decouple the DCP extension (pi-coding-agent closure)
// from vc-agent's TUI layer. The extension writes state / reads triggers;
// vc-agent registers a notifier and consumes state from commands. Same pattern
// as _runtimeEnabledOverride / _dcpConfig above.

let _dcpState: SessionState | undefined;

export function setDcpState(state: SessionState | undefined): void {
	_dcpState = state;
}

export function getDcpState(): SessionState | undefined {
	return _dcpState;
}

let _compressNotifier: ((summary: CompressNotificationSummary) => void) | undefined;

export function setCompressNotifier(
	fn: ((summary: CompressNotificationSummary) => void) | undefined,
): void {
	_compressNotifier = fn;
}

export function getCompressNotifier():
	| ((summary: CompressNotificationSummary) => void)
	| undefined {
	return _compressNotifier;
}

/**
 * Focus text queued by `/dcp-compress [focus]`. Consumed by the DCP context
 * handler on the next LLM call; the extension turns it into a manual compress
 * prompt and rewrites the latest user message (mirrors upstream
 * applyPendingManualTrigger in lib/commands/manual.ts).
 */
let _pendingManualTriggerFocus: string | undefined;

export function setPendingManualTrigger(focus?: string): void {
	_pendingManualTriggerFocus = focus && focus.trim().length > 0 ? focus.trim() : undefined;
}

export function consumePendingManualTrigger(): string | undefined {
	const focus = _pendingManualTriggerFocus;
	_pendingManualTriggerFocus = undefined;
	return focus;
}
