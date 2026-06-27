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
