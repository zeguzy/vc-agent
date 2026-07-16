/**
 * /btw (side conversation) state machine.
 *
 * New design (view-switch + background task card):
 * - `/btw` creates a new empty side AgentSession with an awareness prompt.
 * - The TUI switches its view to the side session (no `switchSession`).
 * - The original (background) session keeps running; `createBackgroundMonitor`
 *   watches it and injects the completion note into the MAIN session when done.
 * - `/btw back` disposes the side session; the monitor stays alive until the
 *   background task completes.
 *
 * This module owns the notification helpers and the background monitor. The
 * lifecycle (enter/back) lives in `AgentServer`; the type `BtwBackgroundTask`
 * is shared between server and TUI state.
 */
import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";

// ─── Types ────────────────────────────────────────────────────

export type BtwStatus = "active" | "done" | "error";

/**
 * Tracks a running /btw side conversation.
 *
 * `sideSession` is null after `/btw back` — the view returns to the main
 * session, but `bgSession`/`bgUnsub`/`status` stay alive so the TUI can keep
 * showing the background-task row until it completes.
 */
export interface BtwBackgroundTask {
	/** The background (original) session — keeps running independently. */
	bgSession: AgentSession;
	/** Subscription to background session events. */
	bgUnsub: () => void;
	/** The side-conversation session. Null after `/btw back`. */
	sideSession: AgentSession | null;
	/** Current status of the background task. */
	status: BtwStatus;
	/** Human-readable summary of what the background task was doing. */
	taskSummary: string;
}

export interface BtwEnterResult {
	backgroundSessionId: string;
	sideSessionId: string;
}

// ─── Notification helpers ─────────────────────────────────────

const NOTIFICATION_PREFIX = "[SYSTEM NOTIFICATION — DO NOT ACT unless there's a problem]\n";
const NOTIFICATION_SUFFIX = "\n[END NOTIFICATION — continue waiting for user or next event]";

/**
 * Inject a notification into a session.
 * When streaming: steer (mid-turn injection, model sees it but doesn't start a new turn).
 * When idle: do NOT actively prompt (matches team member_done behavior —
 * the user will see the update when they next interact).
 */
export function injectNotification(session: AgentSession, body: string): void {
	if (session.isStreaming) {
		const note = `${NOTIFICATION_PREFIX}${body}${NOTIFICATION_SUFFIX}`;
		void session.steer(note);
	}
	// When not streaming: silent — user sees it on next interaction,
	// consistent with team member_done behavior.
}

// ─── Background task awareness prompts ─────────────────────────

const SIDE_AWARENESS_PREFIX = "[SIDE CONVERSATION]\n";
const SIDE_AWARENESS_SUFFIX = "\n[END SIDE CONVERSATION]";

/**
 * Awareness note injected as `appendSystemPrompt` for the side session.
 * Tells the side-session agent that a background task is running, so it can
 * give context-aware replies without dumping full history.
 */
export function buildBtwSideSessionAwarenessNote(taskSummary: string): string {
	return (
		`${SIDE_AWARENESS_PREFIX}` +
		`You are in a side conversation. The main agent is running a background task: ${taskSummary}\n` +
		`You share the same working directory and tools. Answer questions, explore the codebase, ` +
		`or do quick checks without disrupting the background task. When the background task ` +
		`completes, its result is reported to the main session (not here).\n` +
		`${SIDE_AWARENESS_SUFFIX}`
	);
}

export function buildBtwCompletionNote(summary: string): string {
	return `[BACKGROUND TASK COMPLETED]\n${summary}\n[END BACKGROUND TASK]`;
}

export function buildBtwErrorNote(error: string): string {
	return `[BACKGROUND TASK ERROR]\n${error}\n[END BACKGROUND TASK]`;
}

// ─── Background monitor ───────────────────────────────────────

/**
 * Extract a short summary (last assistant message, truncated) from a session.
 * Used both by the monitor and the race-guard path in `handleBtwEnter`.
 */
export function summarizeSessionResult(session: AgentSession): string {
	const messages = session.messages;
	const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
	return lastAssistant
		? truncate(String(lastAssistant.content), 500)
		: "(task completed with no output)";
}

/**
 * Watch a background session; on `agent_end`/errors, inject the result into
 * `targetSession` (the MAIN session) and call `onComplete(status)`.
 *
 * The monitor is independent of `BtwBackgroundTask.sideSession` — it must
 * keep firing even after `/btw back` disposes the side session.
 */
export function createBackgroundMonitor(
	bgSession: AgentSession,
	targetSession: AgentSession,
	onComplete: (status: BtwStatus) => void,
): () => void {
	return bgSession.subscribe((event: AgentSessionEvent) => {
		if (event.type === "agent_end") {
			injectNotification(targetSession, buildBtwCompletionNote(summarizeSessionResult(bgSession)));
			onComplete("done");
		}

		if (event.type === "tool_execution_end" && "isError" in event && event.isError) {
			const toolName = "toolName" in event ? String(event.toolName) : "unknown";
			const errorText = "error" in event ? String(event.error) : "unknown error";
			injectNotification(targetSession, buildBtwErrorNote(`Tool ${toolName} failed: ${errorText}`));
		}
	});
}

// ─── Utility ──────────────────────────────────────────────────

function truncate(text: string, maxLen: number): string {
	if (text.length <= maxLen) return text;
	return `${text.slice(0, maxLen - 3)}...`;
}
