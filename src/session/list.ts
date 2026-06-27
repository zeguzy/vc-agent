import type { SessionInfo } from "@earendil-works/pi-coding-agent";

export type { SessionInfo };

import { SessionManager } from "@earendil-works/pi-coding-agent";
import { resolveSessionDir } from "./storage.js";

/**
 * List persisted sessions for a cwd under the openagent session directory.
 *
 * Thin wrapper around `SessionManager.list` that injects openagent's own
 * `sessionDir` (so sessions never land in `~/.pi/`).
 */
export async function listSessions(
	cwd: string,
	sessionDir: string = resolveSessionDir(),
): Promise<SessionInfo[]> {
	return SessionManager.list(cwd, sessionDir);
}

export function renameSessionFile(
	path: string,
	name: string,
	sessionDir: string = resolveSessionDir(),
): void {
	const manager = SessionManager.open(path, sessionDir);
	manager.appendSessionInfo(name);
}
/**
 * Resolve a `--session <path|id>` / `/resume <ref>` reference against a list.
 *
 * - Pure numeric `ref` → 1-based index into `sessions` (order as rendered).
 * - Otherwise → case-insensitive substring/prefix match against `id`.
 *
 * Returns the matched `path` or `undefined` if nothing matches.
 */
export function resolveSessionRef(sessions: SessionInfo[], ref: string): string | undefined {
	const trimmed = ref.trim();
	if (!trimmed) return undefined;
	if (/^\d+$/.test(trimmed)) {
		const idx = Number.parseInt(trimmed, 10) - 1;
		return sessions[idx]?.path;
	}
	const lower = trimmed.toLowerCase();
	const match = sessions.find((s) => s.id.toLowerCase() === lower);
	if (match) return match.path;
	const prefix = sessions.filter((s) => s.id.toLowerCase().startsWith(lower));
	return prefix.length > 0 ? prefix[0].path : undefined;
}

function startOfDay(d: Date): number {
	const x = new Date(d);
	x.setHours(0, 0, 0, 0);
	return x.getTime();
}

function isSameDay(a: Date, b: Date): boolean {
	return startOfDay(a) === startOfDay(b);
}

function groupLabel(modified: Date, now: Date): string {
	if (isSameDay(modified, now)) return "Today";
	const yesterday = new Date(startOfDay(now) - 24 * 60 * 60 * 1000);
	if (isSameDay(modified, yesterday)) return "Yesterday";
	const y = modified.getFullYear();
	const m = `${modified.getMonth() + 1}`.padStart(2, "0");
	const d = `${modified.getDate()}`.padStart(2, "0");
	return y === now.getFullYear() ? `${m}-${d}` : `${y}-${m}-${d}`;
}

function previewText(info: SessionInfo, maxLen = 48): string {
	const base = info.name?.trim() || info.firstMessage.trim() || "(empty session)";
	return base.length > maxLen ? `${base.slice(0, maxLen - 1)}…` : base;
}

function formatTime(modified: Date, now: Date): string {
	if (isSameDay(modified, now)) {
		const diffMs = now.getTime() - modified.getTime();
		const mins = Math.floor(diffMs / 60000);
		if (mins < 1) return "just now";
		if (mins < 60) return `${mins}m ago`;
		const hrs = Math.floor(mins / 60);
		return `${hrs}h ago`;
	}
	const yesterday = new Date(startOfDay(now) - 24 * 60 * 60 * 1000);
	if (isSameDay(modified, yesterday)) return "yesterday";
	const y = modified.getFullYear();
	const m = `${modified.getMonth() + 1}`.padStart(2, "0");
	const d = `${modified.getDate()}`.padStart(2, "0");
	return y === now.getFullYear() ? `${m}-${d}` : `${y}-${m}-${d}`;
}

/**
 * Render a session list (grouped by time, opencode-style) as a single string
 * suitable for display as an assistant message.
 *
 * Pure function: pass `now` explicitly for deterministic tests.
 */
export function formatSessionList(
	sessions: SessionInfo[],
	currentId?: string,
	now: Date = new Date(),
): string {
	if (sessions.length === 0) return "当前目录暂无会话。使用 `/new` 或直接发消息开始新会话。";

	const sorted = [...sessions].sort((a, b) => b.modified.getTime() - a.modified.getTime());

	const lines: string[] = ["Sessions:", ""];
	let lastGroup = "";
	sorted.forEach((info, i) => {
		const label = groupLabel(info.modified, now);
		if (label !== lastGroup) {
			if (lastGroup) lines.push("");
			lines.push(`  ${label}`);
			lastGroup = label;
		}
		const marker = info.id === currentId ? "▸" : " ";
		const idx = `${i + 1}.`.padStart(3, " ");
		const time = formatTime(info.modified, now).padStart(10, " ");
		const count = `${info.messageCount} msgs`;
		lines.push(`  ${marker}${idx} ${time}  ${previewText(info)}  · ${count}`);
	});
	lines.push("");
	lines.push("用 `/resume <序号|id>` 切换到某个会话（运行时热切换，无需重启）。");
	return lines.join("\n");
}
