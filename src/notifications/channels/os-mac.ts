/**
 * macOS native notification channel.
 *
 * Strategy: prefer `terminal-notifier` from `$PATH` (zero-config when installed
 * via Homebrew), fall back to `osascript -e 'display notification'`.
 *
 * IMPORTANT: never pass `-sender` to terminal-notifier — it hangs on macOS
 * Ventura+ (julienXX/terminal-notifier#301). We accept the loss of
 * "click-to-focus" to avoid the hang.
 */
import { hasBinary, runCmd } from "./spawn.js";

const TERMINAL_NOTIFIER_TIMEOUT_MS = 3000;

async function sendViaTerminalNotifier(
	title: string,
	message: string,
	sound: boolean,
): Promise<boolean> {
	if (!hasBinary("terminal-notifier")) return false;
	const args = ["terminal-notifier", "-title", title, "-message", message];
	if (sound) args.push("-sound", "Glass");
	return runCmd(args, { timeoutMs: TERMINAL_NOTIFIER_TIMEOUT_MS });
}

async function sendViaOsascript(title: string, message: string, sound: boolean): Promise<boolean> {
	if (!hasBinary("osascript")) return false;
	const soundClause = sound ? ' sound name "Glass"' : "";
	const script = `display notification ${JSON.stringify(message)} with title ${JSON.stringify(title)}${soundClause}`;
	return runCmd(["osascript", "-e", script]);
}

/** Deliver a macOS notification, cascading terminal-notifier → osascript. */
export async function sendMacNotification(
	title: string,
	message: string,
	sound = true,
): Promise<boolean> {
	if (await sendViaTerminalNotifier(title, message, sound)) return true;
	return sendViaOsascript(title, message, sound);
}
