/**
 * Notification config defaults and resolution.
 *
 * `resolveNotificationsConfig` merges user-supplied partial config with defaults
 * and is the single source of truth for runtime notification behavior.
 */
import type { NotificationsConfig, ResolvedNotificationsConfig } from "./types.js";

/** Default bash duration before a "long bash" notification fires (10 seconds). */
export const DEFAULT_BASH_THRESHOLD_MS = 10_000;

/** Default auto-dismiss delay for the TUI toast (4 seconds). */
export const DEFAULT_TOAST_DISMISS_MS = 4_000;

/**
 * Returns the fully-resolved default config (everything on).
 * Used when `Config.notifications` is entirely absent.
 */
export function getDefaultNotificationsConfig(): ResolvedNotificationsConfig {
	return {
		enabled: true,
		sound: true,
		bashThresholdMs: DEFAULT_BASH_THRESHOLD_MS,
		toastDismissMs: DEFAULT_TOAST_DISMISS_MS,
		events: {
			agentEnd: true,
			toolError: true,
			longBash: true,
			needsInput: true,
			compactionEnd: true,
			yank: true,
		},
		channels: {
			toast: true,
			osc: true,
			os: true,
		},
	};
}

/**
 * Merge a (possibly partial / undefined) user config with defaults.
 *
 * Semantics:
 * - `undefined` input → all defaults (everything on).
 * - `enabled: false` → master switch off; other fields still resolved for
 *   introspection but `enabled` short-circuits all dispatch.
 * - Nested `events.*` / `channels.*` fall back to defaults per-field.
 */
export function resolveNotificationsConfig(
	config?: NotificationsConfig,
): ResolvedNotificationsConfig {
	const defaults = getDefaultNotificationsConfig();
	if (!config) return defaults;

	return {
		enabled: config.enabled ?? defaults.enabled,
		sound: config.sound ?? defaults.sound,
		bashThresholdMs: config.bashThresholdMs ?? defaults.bashThresholdMs,
		toastDismissMs: config.toastDismissMs ?? defaults.toastDismissMs,
		events: {
			agentEnd: config.events?.agentEnd ?? defaults.events.agentEnd,
			toolError: config.events?.toolError ?? defaults.events.toolError,
			longBash: config.events?.longBash ?? defaults.events.longBash,
			needsInput: config.events?.needsInput ?? defaults.events.needsInput,
			compactionEnd: config.events?.compactionEnd ?? defaults.events.compactionEnd,
			yank: config.events?.yank ?? defaults.events.yank,
		},
		channels: {
			toast: config.channels?.toast ?? defaults.channels.toast,
			osc: config.channels?.osc ?? defaults.channels.osc,
			os: config.channels?.os ?? defaults.channels.os,
		},
	};
}
