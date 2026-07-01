/**
 * Windows native notification channel.
 *
 * v1 is best-effort: prefer SnoreToast.exe if on PATH, otherwise fall back to a
 * PowerShell balloon via System.Windows.Forms. Not a first-class platform in
 * v1 — the goal is to not crash and to deliver when the binary is present.
 */
import { hasBinary, runCmd } from "./spawn.js";

async function sendViaSnoreToast(title: string, message: string): Promise<boolean> {
	const exe = hasBinary("SnoreToast.exe")
		? "SnoreToast.exe"
		: hasBinary("snoretoast")
			? "snoretoast"
			: null;
	if (!exe) return false;
	return runCmd([exe, "-t", title, "-m", message, "-appID", "openagent"]);
}

async function sendViaPowerShell(title: string, message: string): Promise<boolean> {
	const exe = hasBinary("powershell.exe")
		? "powershell.exe"
		: hasBinary("powershell")
			? "powershell"
			: null;
	if (!exe) return false;
	const cmd = `[System.Reflection.Assembly]::LoadWithPartialName("System.Windows.Forms") | Out-Null; $n = New-Object System.Windows.Forms.NotifyIcon; $n.Icon = [System.Drawing.SystemIcons]::Information; $n.Visible = $true; $n.ShowBalloonTip(5000, ${JSON.stringify(title)}, ${JSON.stringify(message)}, [System.Windows.Forms.ToolTipIcon]::Info)`;
	return runCmd([exe, "-NoProfile", "-Command", cmd]);
}

/** Deliver a Windows notification, cascading SnoreToast → PowerShell balloon. */
export async function sendWindowsNotification(title: string, message: string): Promise<boolean> {
	if (await sendViaSnoreToast(title, message)) return true;
	return sendViaPowerShell(title, message);
}
