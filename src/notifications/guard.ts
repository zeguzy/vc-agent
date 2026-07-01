/**
 * Environment guards for the OS native notification channel.
 *
 * Two distinct checks because OSC and OS-native channels have different
 * SSH semantics:
 * - OSC sequences can traverse SSH to reach the local terminal emulator, so
 *   OSC should still be attempted under SSH.
 * - OS-native binaries (osascript / notify-send) run on the remote host where
 *   no user is looking, so they must no-op under SSH.
 */
import { existsSync } from "node:fs";
import { hasBinary } from "./channels/spawn.js";

/** True when the process was reached over SSH (OSC still allowed, OS native not). */
export function isSshSession(): boolean {
	return Boolean(process.env.SSH_CONNECTION || process.env.SSH_TTY);
}

function hasLinuxGuiSession(): boolean {
	return Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
}

function hasLinuxDBus(): boolean {
	if (typeof process.getuid === "function") {
		return existsSync(`/run/user/${process.getuid()}/bus`);
	}
	return false;
}

/**
 * Decide whether to attempt the platform-native binary channel at all.
 * macOS always qualifies (Aqua session). Linux requires GUI + D-Bus + notify-send.
 * SSH sessions never qualify. Windows always qualifies (the channel itself
 * probes for binaries).
 */
export function shouldAttemptOsChannel(): boolean {
	if (isSshSession()) return false;
	if (process.platform === "darwin") return true;
	if (process.platform === "linux") {
		return hasLinuxGuiSession() && hasLinuxDBus() && hasBinary("notify-send");
	}
	// win32 and others: let the channel decide via hasBinary probes.
	return true;
}
