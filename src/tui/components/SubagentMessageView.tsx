import { memo } from "react";
import type { SubagentResult } from "../../agents/types.js";
import type { Message } from "../../message.js";
import { colors, icons } from "../utils/theme.js";

const PREVIEW_CHARS = 200;
const RUNNING_TAIL_LINES = 8;
const SESSION_ID_MAX = 16;

interface ToolArgs {
	agent?: string;
	mode?: string;
	description?: string;
	category?: string;
	tasks?: Array<{ agent: string; description: string }>;
}

interface TaskMetadata {
	sessionId?: string;
	agent?: string;
	category?: string;
	backgroundTaskId?: string;
}

const METADATA_RE = /<task_metadata\s+([^/>]*?)\s*\/>/i;

/** Parse `<task_metadata session_id="..." ... />` attribute string into a typed object. */
function parseMetadataAttrs(attrText: string): TaskMetadata {
	const meta: TaskMetadata = {};
	const attrRe = /(\w+)\s*=\s*"([^"]*)"/g;
	for (const m of attrText.matchAll(attrRe)) {
		const val = m[2];
		if (val === "") continue;
		switch (m[1]) {
			case "session_id":
				meta.sessionId = val;
				break;
			case "agent":
				meta.agent = val;
				break;
			case "category":
				meta.category = val;
				break;
			case "background_task_id":
				meta.backgroundTaskId = val;
				break;
		}
	}
	return meta;
}

/**
 * Extract `<task_metadata ... />` from a Markdown result string.
 * Returns the parsed metadata (null if absent/empty) and the text with the
 * raw XML block (and any trailing blank line it left) removed.
 */
function extractTaskMetadata(text: string): { metadata: TaskMetadata | null; cleaned: string } {
	const m = text.match(METADATA_RE);
	if (!m) return { metadata: null, cleaned: text };
	const parsed = parseMetadataAttrs(m[1]);
	const hasAny = Boolean(
		parsed.sessionId || parsed.agent || parsed.category || parsed.backgroundTaskId,
	);
	const cleaned = text
		.replace(METADATA_RE, "")
		.replace(/\n{3,}/g, "\n\n")
		.trimEnd();
	return { metadata: hasAny ? parsed : null, cleaned };
}

/** Compact one-line rendering of metadata, e.g. `ses_abc123 · deep · bg_7`. */
function formatMetadataLine(meta: TaskMetadata): string {
	const parts: string[] = [];
	if (meta.sessionId) parts.push(truncateStr(meta.sessionId, SESSION_ID_MAX));
	if (meta.category) parts.push(meta.category);
	if (meta.backgroundTaskId) parts.push(meta.backgroundTaskId);
	return parts.join(" · ");
}

/** Build a TaskMetadata view from a structured SubagentResult (no string parsing). */
function metadataFromResult(r: SubagentResult): TaskMetadata {
	return {
		sessionId: r.sessionId,
		agent: r.agent,
		category: r.category,
		backgroundTaskId: r.backgroundTaskId,
	};
}

function extractText(result: unknown): string {
	if (result == null) return "";
	if (typeof result === "string") return result;
	if (typeof result === "object" && result !== null) {
		const r = result as Record<string, unknown>;
		if (Array.isArray(r.content)) {
			return (r.content as Array<Record<string, unknown>>)
				.filter((c) => c.type === "text" && typeof c.text === "string")
				.map((c) => c.text as string)
				.join("\n");
		}
		if (typeof r.text === "string") return r.text;
	}
	return "";
}

function lastLines(text: string, n: number): string[] {
	return text
		.split("\n")
		.filter((l) => l.length > 0)
		.slice(-n);
}

function truncateStr(text: string, max: number): string {
	return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}

function formatUsage(u: SubagentResult["usage"]): string | null {
	if (!u) return null;
	const tokens = u.inputTokens + u.outputTokens;
	return `${tokens} tok · $${u.cost.toFixed(4)} · ${u.turns} turns`;
}

export const SubagentMessageView = memo(function SubagentMessageView({
	message,
}: {
	message: Message;
}) {
	const details = message.subagentDetails;
	const args = (message.toolArgs ?? {}) as ToolArgs;

	const mode = details?.mode ?? args.mode ?? "single";
	const firstResult = details?.results?.[0];
	const firstAgent = firstResult?.agent ?? args.agent ?? "subagent";
	const description =
		args.description ?? firstResult?.description ?? args.tasks?.[0]?.description ?? "";
	const category = firstResult?.category ?? args.category;
	const taskCount = details?.results?.length ?? args.tasks?.length ?? 1;
	const showMode = mode !== "single";
	const showCount = taskCount > 1;

	const icon =
		message.toolStatus === "running"
			? icons.toolRunning
			: message.toolStatus === "error"
				? icons.toolError
				: icons.toolDone;
	const statusFg =
		message.toolStatus === "running"
			? colors.textMuted
			: message.toolStatus === "error"
				? colors.error
				: colors.success;
	const borderColor =
		message.toolStatus === "running"
			? colors.borderActive
			: message.toolStatus === "error"
				? colors.error
				: colors.borderSoft;

	const titleParts = [firstAgent];
	if (mode === "single" && category) titleParts.push(`· ${category}`);
	if (showMode) titleParts.push(`· ${mode}`);
	if (showCount) titleParts.push(`· ${taskCount} tasks`);

	let body: React.ReactNode = null;
	if (message.toolStatus === "running") {
		const text = extractText(message.toolResult);
		const lines = text ? lastLines(text, RUNNING_TAIL_LINES) : [];
		body =
			lines.length > 0 ? (
				<box flexDirection="column" paddingLeft={2} paddingRight={1}>
					{lines.map((line, i) => (
						<text key={`run-${i}`} fg={colors.textMuted}>
							{line}
						</text>
					))}
				</box>
			) : (
				<box paddingLeft={2} paddingRight={1}>
					<text fg={colors.textMuted}>running…</text>
				</box>
			);
	} else if (details && details.results.length > 0) {
		const rows = details.results.map((r, i) => {
			const usage = formatUsage(r.usage);
			const metaLine = formatMetadataLine(metadataFromResult(r));
			const preview = truncateStr(r.output, PREVIEW_CHARS);
			return (
				<box key={`res-${i}`} flexDirection="column">
					<box flexDirection="row">
						<text fg={colors.secondary}>{r.agent}</text>
						<text fg={colors.textSubtle}> {truncateStr(r.description, 60)}</text>
					</box>
					{metaLine ? <text fg={colors.textSubtle}>§ {metaLine}</text> : null}
					{r.error ? (
						<text fg={colors.error}> {truncateStr(r.error, PREVIEW_CHARS)}</text>
					) : (
						<text fg={colors.textMuted}> {preview}</text>
					)}
					{usage ? <text fg={colors.textSubtle}> {usage}</text> : null}
				</box>
			);
		});
		body = (
			<box flexDirection="column" paddingLeft={2} paddingRight={1}>
				{rows}
				<text fg={colors.textSubtle}>
					Total: ${details.totalCost.toFixed(4)} · {details.totalTurns} turns
				</text>
			</box>
		);
	} else {
		const rawText = extractText(message.toolResult);
		const { metadata, cleaned } = extractTaskMetadata(rawText);
		const metaLine = metadata ? formatMetadataLine(metadata) : "";
		const lines = cleaned ? cleaned.split("\n").slice(0, 15) : [];
		body =
			lines.length > 0 || metaLine ? (
				<box flexDirection="column" paddingLeft={2} paddingRight={1}>
					{metaLine ? <text fg={colors.textSubtle}>§ {metaLine}</text> : null}
					{lines.map((line, i) => (
						<text key={`fb-${i}`} fg={colors.textMuted}>
							{line}
						</text>
					))}
				</box>
			) : null;
	}

	return (
		<box
			borderStyle="rounded"
			border={["top", "right", "bottom", "left"]}
			borderColor={borderColor}
			backgroundColor={colors.backgroundInset}
			marginTop={1}
			flexShrink={0}
			flexDirection="column"
		>
			<box flexDirection="row" paddingLeft={1} paddingRight={1}>
				<text fg={statusFg}>{icon} </text>
				<text fg={colors.secondary}>{titleParts.join(" ")}</text>
				{description ? <text fg={colors.textSubtle}> {truncateStr(description, 50)}</text> : null}
			</box>
			{body}
		</box>
	);
});
