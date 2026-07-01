/**
 * Linux native notification channel via `notify-send` (libnotify-bin).
 *
 * Requires a graphical session (DISPLAY/WAYLAND_DISPLAY) and a D-Bus user bus.
 * Availability guards live in `src/notifications/guard.ts`; this module assumes
 * the environment check has already passed and just attempts the spawn.
 */
import { hasBinary, runCmd } from "./spawn.js";

export async function sendLinuxNotification(title: string, message: string): Promise<boolean> {
	if (!hasBinary("notify-send")) return false;
	return runCmd([
		"notify-send",
		"--app-name=openagent",
		"--urgency=normal",
		"--expire-time=8000",
		title,
		message,
	]);
}
