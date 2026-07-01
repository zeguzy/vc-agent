/**
 * Cross-runtime spawn helpers.
 *
 * Uses Node `child_process` (not `Bun.spawn`) because the project's tsconfig
 * does not include Bun globals. This keeps the notification module buildable
 * under plain `tsc --noEmit`.
 */
import { execFileSync, spawn } from "node:child_process";

/** True when `cmd` is on `$PATH`. Uses `which` (unix) / `where` (win32). */
export function hasBinary(cmd: string): boolean {
	try {
		execFileSync(process.platform === "win32" ? "where" : "which", [cmd], {
			stdio: "ignore",
		});
		return true;
	} catch {
		return false;
	}
}

/**
 * Run `cmd` and resolve `true` on exit code 0.
 * Supports optional abort signal and timeout; both resolve `false`.
 */
export function runCmd(
	cmd: string[],
	opts?: { signal?: AbortSignal; timeoutMs?: number },
): Promise<boolean> {
	return new Promise((resolve) => {
		let settled = false;
		const finish = (ok: boolean) => {
			if (settled) return;
			settled = true;
			if (timer) clearTimeout(timer);
			resolve(ok);
		};
		const timer = opts?.timeoutMs
			? setTimeout(() => {
					try {
						child.kill("SIGKILL");
					} catch {
						// already exited
					}
					finish(false);
				}, opts.timeoutMs)
			: null;

		let child: ReturnType<typeof spawn>;
		try {
			child = spawn(cmd[0], cmd.slice(1), { stdio: "ignore" });
		} catch {
			finish(false);
			return;
		}

		const onAbort = () => {
			try {
				child.kill("SIGTERM");
			} catch {
				// already exited
			}
			finish(false);
		};
		opts?.signal?.addEventListener("abort", onAbort, { once: true });

		child.on("error", () => finish(false));
		child.on("close", (code) => finish(code === 0));
	});
}
