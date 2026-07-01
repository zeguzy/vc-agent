/**
 * OSC terminal notification channel.
 *
 * Uses OpenTUI's `renderer.triggerNotification()` when available, which emits
 * OSC 99/9 escape sequences supported by iTerm2 / Ghostty / WezTerm / Kitty.
 * Falls back (returns false) when the renderer is absent or the API is not
 * present in the installed @opentui/core version.
 */

/** Structural shape of a renderer that supports OSC notifications. */
interface OscCapableRenderer {
	triggerNotification(message: string, title?: string): boolean;
}

function isOscCapable(renderer: unknown): renderer is OscCapableRenderer {
	return (
		typeof renderer === "object" &&
		renderer !== null &&
		typeof (renderer as { triggerNotification?: unknown }).triggerNotification === "function"
	);
}

/**
 * Attempt to deliver a notification via the terminal's OSC protocol.
 * @returns `true` if the renderer accepted it, `false` to signal the caller to fall back.
 */
export function sendOscNotification(renderer: unknown, message: string, title?: string): boolean {
	if (!isOscCapable(renderer)) return false;
	try {
		return renderer.triggerNotification(message, title);
	} catch {
		return false;
	}
}
