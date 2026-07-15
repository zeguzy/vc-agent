/**
 * /btw (side conversation) state machine.
 *
 * When the user types /btw, the current running task goes to background,
 * a new session is forked from the current point, and the user interacts
 * with the forked session. When the background task completes, its result
 * is injected into the forked session via steer().
 *
 * This module owns the lifecycle: enter → monitor → return.
 */
import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";

// ─── Types ────────────────────────────────────────────────────

export interface BtwState {
	/** Session file URI of the background (original) session. */
	returnPath: string;
	/** Captured reference to the background AgentSession — keeps it alive. */
	bgSession: AgentSession;
	/** Independent subscription to background session events. */
	bgUnsub: () => void;
	/** Human-readable summary of what the background task was doing. */
	bgTaskSummary: string;
}

export type BtwPhase = "idle" | "active";

export interface BtwEnterResult {
	backgroundSessionId: string;
	cancelled: boolean;
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

// ─── Background task awareness prompt ─────────────────────────

const BTW_AWARENESS_PREFIX = `[BACKGROUND TASK RUNNING]\n`;
const BTW_AWARENESS_SUFFIX = `\n[END BACKGROUND TASK — result will appear here when done]`;

export function buildBtwAwarenessNote(taskSummary: string): string {
	return `${BTW_AWARENESS_PREFIX}Session is executing: ${taskSummary}\nYou are in a side conversation (forked at this point). The background task continues independently.\nWhen it completes, its result will appear as a notification here.\n${BTW_AWARENESS_SUFFIX}`;
}

export function buildBtwCompletionNote(summary: string): string {
	return `[BACKGROUND TASK COMPLETED]\n${summary}\n[END BACKGROUND TASK]`;
}

export function buildBtwErrorNote(error: string): string {
	return `[BACKGROUND TASK ERROR]\n${error}\n[END BACKGROUND TASK]`;
}

// ─── Background monitor ───────────────────────────────────────

/**
 * Create a background session event monitor.
 * Returns the unsubscribe handle.
 *
 * The monitor watches for:
 * - `agent_end`: background task completed → inject result
 * - errors: background task failed → inject error
 */
export function createBackgroundMonitor(
	bgSession: AgentSession,
	targetSession: AgentSession,
	onComplete: () => void,
): () => void {
	return bgSession.subscribe((event: AgentSessionEvent) => {
		if (event.type === "agent_end") {
			// Extract a brief summary from the last assistant message
			const messages = bgSession.messages;
			const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
			const summary = lastAssistant
				? truncate(String(lastAssistant.content), 500)
				: "(task completed with no output)";
			injectNotification(targetSession, buildBtwCompletionNote(summary));
			onComplete();
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
