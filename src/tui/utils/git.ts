import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function getGitBranch(cwd: string): string {
	try {
		const gitHead = join(cwd, ".git", "HEAD");
		if (!existsSync(gitHead)) return "";
		const content = readFileSync(gitHead, "utf-8").trim();
		const match = content.match(/^ref:\s*refs\/heads\/(.+)$/);
		return match ? match[1] : "";
	} catch {
		return "";
	}
}

export async function getGitDirty(cwd: string): Promise<boolean> {
	try {
		const { stdout } = await execFileAsync("git", ["status", "--porcelain"], { cwd });
		return stdout.trim().length > 0;
	} catch {
		return false;
	}
}
