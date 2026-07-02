/**
 * NotificationRouter — the single orchestration point that turns Pi SDK events
 * into user-facing notifications.
 *
 * Subscribed once inside `AgentServer.ensureSubscribed()` so it covers TUI,
 * headless `run`, and `serve`+`attach` modes uniformly. Channel cascade:
 * TUI Toast (always when TUI present) ‖ OSC → OS native → silent no-op.
 */
import type { AgentSessionEvent } from "../agent/session.js";
import { sendLinuxNotification } from "./channels/os-linux.js";
import { sendMacNotification } from "./channels/os-mac.js";
import { sendWindowsNotification } from "./channels/os-windows.js";
import { sendOscNotification } from "./channels/osc.js";
import { resolveNotificationsConfig } from "./config.js";
import { getNotificationBus } from "./event-bus.js";
import { shouldAttemptOsChannel } from "./guard.js";
import type {
	NotificationPayload,
	NotificationsConfig,
	ResolvedNotificationsConfig,
} from "./types.js";

export interface NotificationRouterOptions {
	config?: NotificationsConfig;
	/** The OpenTUI renderer instance (TUI mode). May be set later via `setRenderer`. */
	renderer?: unknown;
	/** TUI toast callback (TUI mode). May be set later via `setToastHandler`. */
	onToast?: (payload: NotificationPayload) => void;
}

/**
 * Process-wide singleton. Set by the server on startup so the `question` tool
 * (which lives below the server layer) can request "needs input" notifications
 * without a constructor-injected dependency.
 */
let globalRouter: NotificationRouter | null = null;

export function setGlobalRouter(router: NotificationRouter | null): void {
	globalRouter = router;
}

export function getGlobalRouter(): NotificationRouter | null {
	return globalRouter;
}

export class NotificationRouter {
	private config: ResolvedNotificationsConfig;
	private renderer: unknown;
	private onToast?: (payload: NotificationPayload) => void;
	/** `toolCallId` → start timestamp, for long-bash detection. */
	private readonly bashStartTimes = new Map<string, number>();

	constructor(opts: NotificationRouterOptions = {}) {
		this.config = resolveNotificationsConfig(opts.config);
		this.renderer = opts.renderer;
		this.onToast = opts.onToast;
	}

	updateConfig(config?: NotificationsConfig): void {
		this.config = resolveNotificationsConfig(config);
	}

	setEnabled(enabled: boolean): void {
		this.config = { ...this.config, enabled };
	}

	setSound(sound: boolean): void {
		this.config = { ...this.config, sound };
	}

	setBashThresholdMs(ms: number): void {
		this.config = { ...this.config, bashThresholdMs: ms };
	}

	setRenderer(renderer: unknown): void {
		this.renderer = renderer;
	}

	setToastHandler(fn?: (payload: NotificationPayload) => void): void {
		this.onToast = fn;
	}

	private sendToast(payload: NotificationPayload): void {
		if (!this.config.channels.toast) return;
		this.onToast?.(payload);
	}

	private async sendExternal(title: string, message: string): Promise<void> {
		if (this.config.channels.osc && sendOscNotification(this.renderer, message, title)) {
			return;
		}
		if (!this.config.channels.os || !shouldAttemptOsChannel()) return;
		const sound = this.config.sound;
		try {
			if (process.platform === "darwin") {
				await sendMacNotification(title, message, sound);
			} else if (process.platform === "linux") {
				await sendLinuxNotification(title, message);
			} else if (process.platform === "win32") {
				await sendWindowsNotification(title, message);
			}
		} catch {
			// Notification failure must never bubble into the main flow.
		}
	}

	/** Dispatch a payload through every enabled channel + the event bus. */
	notify(payload: NotificationPayload): void {
		if (!this.config.enabled) return;
		if (!payload.skipToast) this.sendToast(payload);
		if (!payload.toastOnly) {
			void this.sendExternal(payload.title, payload.message);
		}
		getNotificationBus().emit(payload);
	}

	/** Consume a raw Pi SDK event and notify (or no-op) accordingly. */
	async handleEvent(event: AgentSessionEvent): Promise<void> {
		if (!this.config.enabled) return;
		const payload = this.translate(event);
		if (payload) this.notify(payload);
	}

	/** Direct hook for the `question` tool (not an AgentSessionEvent). */
	notifyNeedsInput(message = "等待回复"): void {
		if (!this.config.enabled || !this.config.events.needsInput) return;
		this.notify({ event: "needsInput", title: "openagent", message });
	}

	private translate(event: AgentSessionEvent): NotificationPayload | null {
		switch (event.type) {
			case "agent_end":
				return this.config.events.agentEnd
					? { event: "agentEnd", title: "openagent", message: "回复完成", skipToast: true }
					: null;

			case "tool_execution_start":
				if (event.toolName === "bash") {
					this.bashStartTimes.set(event.toolCallId, Date.now());
				}
				return null;

			case "tool_execution_end": {
				if (event.isError && this.config.events.toolError) {
					return {
						event: "toolError",
						title: "openagent",
						message: `${event.toolName} 失败`,
					};
				}
				if (event.toolName === "bash" && this.config.events.longBash) {
					const start = this.bashStartTimes.get(event.toolCallId);
					this.bashStartTimes.delete(event.toolCallId);
					if (start !== undefined) {
						const elapsedMs = Date.now() - start;
						if (elapsedMs >= this.config.bashThresholdMs) {
							return {
								event: "longBash",
								title: "openagent",
								message: `bash 完成 (${Math.round(elapsedMs / 1000)}s)`,
							};
						}
					}
				}
				return null;
			}

			case "compaction_end":
				if (!this.config.events.compactionEnd) return null;
				if (event.aborted || event.errorMessage) return null;
				return {
					event: "compactionEnd",
					title: "openagent",
					message: "压缩完成",
					toastOnly: true,
				};

			default:
				return null;
		}
	}
}
