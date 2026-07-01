/**
 * Notification system types.
 *
 * Events flow from `AgentServer.ensureSubscribed()` (src/server/index.ts) into
 * `NotificationRouter`, which translates them into `NotificationPayload`s and
 * dispatches through the cascading channel strategy (OSC → OS native → no-op).
 */

/** Logical notification event categories that map onto Pi SDK events. */
export type NotificationEvent =
	| "agentEnd"
	| "toolError"
	| "longBash"
	| "needsInput"
	| "compactionEnd";

/** Per-event enable flags. Undefined = default (on). */
export interface NotificationEventsConfig {
	agentEnd?: boolean;
	toolError?: boolean;
	longBash?: boolean;
	needsInput?: boolean;
	compactionEnd?: boolean;
}

/** Per-channel enable flags. Undefined = default (on). */
export interface NotificationChannelsConfig {
	/** TUI in-app toast (TUI mode only). Undefined = on. */
	toast?: boolean;
	/** OpenTUI OSC 99/9 terminal notification. Undefined = on. */
	osc?: boolean;
	/** Platform native binary (terminal-notifier / notify-send / SnoreToast). Undefined = on. */
	os?: boolean;
}

/** Top-level notifications config block under `Config.notifications`. */
export interface NotificationsConfig {
	/** Master switch. Undefined = on. When false, no notifications fire at all. */
	enabled?: boolean;
	/** Play the channel's default sound. Undefined = on. */
	sound?: boolean;
	/** Bash duration threshold in milliseconds before a "long bash" notification fires. */
	bashThresholdMs?: number;
	events?: NotificationEventsConfig;
	channels?: NotificationChannelsConfig;
}

/** A resolved (defaults-merged) notification config used at runtime. */
export interface ResolvedNotificationsConfig {
	enabled: boolean;
	sound: boolean;
	bashThresholdMs: number;
	events: Required<NotificationEventsConfig>;
	channels: Required<NotificationChannelsConfig>;
}

/** A notification request produced from an agent event. */
export interface NotificationPayload {
	event: NotificationEvent;
	title: string;
	message: string;
	/** When true, only deliver via TUI toast, skip OSC/OS channels. */
	toastOnly?: boolean;
}
