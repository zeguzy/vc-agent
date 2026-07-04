/**
 * TEMPORARY diagnostic logger for notification debugging.
 * Writes to /tmp/openagent-notif.log. Remove after root cause is found.
 */
import { appendFileSync } from "node:fs";

const LOG_PATH = "/tmp/openagent-notif.log";

export function diagLog(label: string, data?: unknown): void {
	const ts = new Date().toISOString();
	const line = data !== undefined ? `[${ts}] ${label}: ${safeStr(data)}` : `[${ts}] ${label}`;
	try {
		appendFileSync(LOG_PATH, `${line}\n`);
	} catch {
		// ignore
	}
}

function safeStr(data: unknown): string {
	try {
		if (data instanceof Error) return `${data.message}\n${data.stack ?? ""}`;
		if (typeof data === "object" && data !== null) {
			const keys = Object.keys(data);
			const trimmed = keys
				.slice(0, 8)
				.map((k) => `${k}=${safeStr((data as Record<string, unknown>)[k])}`);
			return `{${trimmed.join(", ")}${keys.length > 8 ? ", …" : ""}}`;
		}
		return String(data);
	} catch {
		return "<unserializable>";
	}
}
