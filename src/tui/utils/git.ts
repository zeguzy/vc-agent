import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

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

export function getGitDirty(cwd: string): boolean {
	try {
		const result = execSync("git status --porcelain", { cwd, encoding: "utf-8" });
		return result.trim().length > 0;
	} catch {
		return false;
	}
}
