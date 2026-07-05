import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const LOG_DIR = join(homedir(), ".config", "openagent", "logs", "teams");

function ensureDir(): void {
	if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
}

function logFile(): string {
	const date = new Date().toISOString().slice(0, 10);
	return join(LOG_DIR, `${date}.jsonl`);
}

export function logTeamEvent(event: string, data: Record<string, unknown> = {}): void {
	ensureDir();
	const entry = {
		ts: new Date().toISOString(),
		event,
		...data,
	};
	try {
		appendFileSync(logFile(), `${JSON.stringify(entry)}\n`, "utf-8");
	} catch {
		// Silently fail — logging is non-critical
	}
}

export function logTeamSnapshot(
	members: Array<{ name: string; status: string; role: string; id: string }>,
	tasks: Array<{ title: string; status: string; id: string; assignedTo?: string }>,
	trigger: "heartbeat" | "status_change" | "manual",
): void {
	logTeamEvent("status_snapshot", {
		trigger,
		members: members.map((m) => ({
			id: m.id.slice(0, 10),
			name: m.name,
			status: m.status,
			role: m.role,
		})),
		tasks: tasks.map((t) => ({
			id: t.id.slice(0, 10),
			title: t.title,
			status: t.status,
			assignedTo: t.assignedTo?.slice(0, 10),
		})),
	});
}
