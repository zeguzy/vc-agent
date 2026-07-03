import { memo } from "react";
import type { SubagentResult } from "../../agents/types.js";
import type { Message, SubagentToolDetails } from "../../message.js";
import { colors, icons } from "../utils/theme.js";

const PREVIEW_CHARS = 200;
const RUNNING_TAIL_LINES = 8;

interface ToolArgs {
	agent?: string;
	mode?: string;
	description?: string;
	tasks?: Array<{ agent: string; description: string }>;
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
	return text.length <= max ? text : `${text.slice(0, max)}…`;
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
	const firstAgent = details?.results?.[0]?.agent ?? args.agent ?? "subagent";
	const description =
		args.description ?? details?.results?.[0]?.description ?? args.tasks?.[0]?.description ?? "";
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
	if (showMode) titleParts.push(`· ${mode}`);
	if (showCount) titleParts.push(`· ${taskCount} tasks`);

	let body: React.ReactNode = null;
	if (message.toolStatus === "running") {
		const text = extractText(message.toolResult);
		const lines = text ? lastLines(text, RUNNING_TAIL_LINES) : [];
		body =
			lines.length > 0 ? (
				<box flexDirection="column" paddingLeft={3} paddingRight={1}>
					{lines.map((line, i) => (
						<text key={`run-${i}`} fg={colors.textMuted}>
							{line}
						</text>
					))}
				</box>
			) : (
				<box paddingLeft={3} paddingRight={1}>
					<text fg={colors.textMuted}>running…</text>
				</box>
			);
	} else if (details && details.results.length > 0) {
		const rows = details.results.map((r, i) => {
			const usage = formatUsage(r.usage);
			const preview = truncateStr(r.output, PREVIEW_CHARS);
			return (
				<box key={`res-${i}`} flexDirection="column" paddingBottom={0}>
					<box flexDirection="row">
						<text fg={colors.secondary}>{r.agent}</text>
						<text fg={colors.textSubtle}> {truncateStr(r.description, 60)}</text>
					</box>
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
			<box flexDirection="column" paddingLeft={3} paddingRight={1}>
				{rows}
				<text fg={colors.textSubtle}>
					Total: ${details.totalCost.toFixed(4)} · {details.totalTurns} turns
				</text>
			</box>
		);
	} else {
		const text = extractText(message.toolResult);
		const lines = text ? text.split("\n").slice(0, 15) : [];
		body =
			lines.length > 0 ? (
				<box flexDirection="column" paddingLeft={3} paddingRight={1}>
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
