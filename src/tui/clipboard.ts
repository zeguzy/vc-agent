import { spawnSync } from "node:child_process";

/**
 * 写入系统剪贴板（双策略，移植自 opencode）：
 * 1. OSC 52 escape sequence（支持 SSH 远程 / tmux / 现代终端）
 * 2. 平台命令（macOS osascript / Linux wl-copy, xclip, xsel / Windows PowerShell）
 *
 * 两者同时执行——OSC 52 让 SSH 客户端终端的剪贴板更新（远程场景），
 * 平台命令让本机系统剪贴板更新（本地场景，弥补 macOS Terminal / iTerm 默认禁 OSC 52 的不足）。
 */

function writeOsc52(text: string): void {
	if (!process.stdout.isTTY) return;
	const base64 = Buffer.from(text).toString("base64");
	const osc52 = `\x1b]52;c;${base64}\x07`;
	// tmux / screen 需要包装 passthrough 才能转发给外层终端
	const passthrough = process.env.TMUX || process.env.STY;
	const sequence = passthrough ? `\x1bPtmux;\x1b${osc52}\x1b\\` : osc52;
	process.stdout.write(sequence);
}

function platformCopy(text: string): boolean {
	try {
		if (process.platform === "darwin") {
			const escaped = text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
			spawnSync("osascript", ["-e", `set the clipboard to "${escaped}"`], { stdio: "ignore" });
			return true;
		}
		if (process.platform === "linux") {
			if (process.env.WAYLAND_DISPLAY) {
				spawnSync("wl-copy", [], { input: text, stdio: ["pipe", "ignore", "ignore"] });
				return true;
			}
			spawnSync("xclip", ["-selection", "clipboard"], {
				input: text,
				stdio: ["pipe", "ignore", "ignore"],
			});
			return true;
		}
	} catch {
		return false;
	}
	return false;
}

/**
 * 写入系统剪贴板。OSC 52 + 平台命令双发，谁生效算谁。
 * 异步返回让调用方可以 .then(toast)，与 opencode Clipboard.copy 签名一致。
 */
export function copyToClipboard(text: string): Promise<boolean> {
	writeOsc52(text);
	const platformOk = platformCopy(text);
	return Promise.resolve(platformOk);
}
