import type { ScrollBoxRenderable } from "@opentui/core";
import { memo } from "react";
import type { Message } from "../../message.js";
import { splitStreamingText } from "../utils/streaming.js";
import { syntaxStyle } from "../utils/syntax.js";
import { colors, icons } from "../utils/theme.js";

export interface ReadEntry {
	path: string;
	shortPath: string;
	range?: string;
	result: string[];
	status: "running" | "done" | "error";
}

function extractReadInfo(msg: Message): ReadEntry {
	const a = (msg.toolArgs ?? {}) as Record<string, unknown>;
	const path = String(a.path ?? a.filePath ?? "");
	const shortPath = path.split("/").slice(-2).join("/");
	const offset = a.offset as number | undefined;
	const limit = a.limit as number | undefined;
	let range: string | undefined;
	if (offset && limit) range = `:${offset}-${offset + limit - 1}`;
	else if (offset) range = `:${offset}+`;
	const result = formatToolResult(msg.toolResult);
	return { path, shortPath, range, result, status: msg.toolStatus ?? "running" };
}

const UserMessageView = memo(function UserMessageView({
	message,
	index,
}: {
	message: Message;
	index: number;
}) {
	return (
		<box
			borderStyle="rounded"
			border={["top", "right", "bottom", "left"]}
			borderColor={colors.borderSoft}
			marginTop={index === 0 ? 0 : 1}
			flexShrink={0}
		>
			<box
				backgroundColor={colors.backgroundPanel}
				paddingTop={1}
				paddingBottom={1}
				paddingLeft={2}
				paddingRight={2}
				flexShrink={0}
			>
				<text fg={colors.text}>{message.content}</text>
			</box>
		</box>
	);
});

function AssistantMessageView({
	message,
	thinkingCollapsed,
}: {
	message: Message;
	thinkingCollapsed?: boolean;
}) {
	const hasThinking = message.thinking && message.thinking.trim();
	const collapsed = thinkingCollapsed && hasThinking;
	const split = splitStreamingText(message.content);
	return (
		<box paddingLeft={3} marginTop={1} flexShrink={0} flexDirection="column">
			{hasThinking && (
				<box flexDirection="column" flexShrink={0}>
					<text fg={colors.warning}>{collapsed ? "+ Thinking …" : "- Thinking"}</text>
					{!collapsed && (
						<box flexDirection="column" marginTop={0}>
							{message
								.thinking!.split("\n")
								.filter((l) => l.trim())
								.map((line, i) => (
									<text key={i} fg={colors.textSubtle}>
										{line}
									</text>
								))}
						</box>
					)}
				</box>
			)}
			{message.content && (
				<box marginTop={hasThinking && !collapsed ? 1 : 0} flexDirection="column">
					{split.tail ? (
						<>
							{split.head && (
								<markdown
									syntaxStyle={syntaxStyle}
									streaming={false}
									content={split.head}
									fg={colors.markdownText}
									bg={colors.background}
								/>
							)}
							<text fg={colors.markdownText}>{split.tail}</text>
						</>
					) : (
						<markdown
							syntaxStyle={syntaxStyle}
							streaming={true}
							content={message.content}
							fg={colors.markdownText}
							bg={colors.background}
						/>
					)}
				</box>
			)}
		</box>
	);
}

function formatToolDetail(toolName: string, args: unknown): { label: string; lines: string[] } {
	if (!args || typeof args !== "object") return { label: toolName, lines: [] };
	const a = args as Record<string, unknown>;
	switch (toolName) {
		case "read": {
			const fp = String(a.path ?? a.filePath ?? "");
			const offset = a.offset as number | undefined;
			const limit = a.limit as number | undefined;
			const lines = [fp];
			if (offset && limit) lines.push(`:${offset}-${offset + limit - 1}`);
			else if (offset) lines.push(`:${offset}+`);
			return { label: "read", lines };
		}
		case "bash": {
			const cmd = String(a.command ?? "");
			return { label: "bash", lines: [cmd.length > 100 ? cmd.slice(0, 97) + "..." : cmd] };
		}
		case "edit": {
			const fp = String(a.path ?? a.filePath ?? "");
			const lines = [fp];
			const edits = a.edits as Array<Record<string, unknown>> | undefined;
			if (edits && edits.length > 0) {
				const first = edits[0];
				const oldT = truncate(String(first.oldText ?? first.oldString ?? ""), 80);
				const newT = truncate(String(first.newText ?? first.newString ?? ""), 80);
				lines.push(`- ${oldT}`);
				lines.push(`+ ${newT}`);
				if (edits.length > 1) lines.push(`... ${edits.length - 1} more edits`);
			}
			return { label: "edit", lines };
		}
		case "write": {
			const fp = String(a.path ?? a.filePath ?? "");
			const content = String(a.content ?? "");
			const lines = [fp];
			if (content) {
				const lineCount = content.split("\n").length;
				lines.push(`${lineCount} lines`);
			}
			return { label: "write", lines };
		}
		case "grep": {
			const pattern = String(a.pattern ?? "");
			const dir = a.path ? String(a.path) : undefined;
			const glob = a.glob ? String(a.glob) : undefined;
			const flags: string[] = [];
			if (a.ignoreCase) flags.push("-i");
			if (a.literal) flags.push("-F");
			if (a.context != null) flags.push(`-C${a.context}`);
			const lines: string[] = [];
			if (dir) lines.push(dir);
			const flagStr = flags.length > 0 ? ` ${flags.join(" ")}` : "";
			lines.push(`/${pattern}/${flagStr}`);
			if (glob) lines.push(`glob: ${glob}`);
			return { label: "grep", lines };
		}
		case "find": {
			const pattern = String(a.pattern ?? "");
			const dir = a.path ? String(a.path) : undefined;
			const lines: string[] = [];
			if (dir) lines.push(dir);
			lines.push(pattern);
			if (a.limit != null) lines.push(`limit: ${a.limit}`);
			return { label: "find", lines };
		}
		case "lsp_diagnostics": {
			const fp = String(a.filePath ?? "");
			const severity = a.severity ? String(a.severity) : undefined;
			const lines = [fp];
			if (severity && severity !== "all") lines.push(`severity: ${severity}`);
			return { label: "lsp_diagnostics", lines };
		}
		case "lsp_goto_definition": {
			const fp = String(a.filePath ?? "");
			const lines: string[] = [fp];
			if (a.line != null && a.character != null) lines.push(`${a.line}:${a.character}`);
			return { label: "lsp_goto_definition", lines };
		}
		case "lsp_find_references": {
			const fp = String(a.filePath ?? "");
			const lines: string[] = [fp];
			if (a.line != null && a.character != null) lines.push(`${a.line}:${a.character}`);
			if (a.includeDeclaration === false) lines.push("excl. declaration");
			return { label: "lsp_find_references", lines };
		}
		default:
			return { label: toolName, lines: [] };
	}
}

function formatToolResult(result: unknown): string[] {
	if (result == null) return [];
	let text: string;
	if (typeof result === "string") {
		text = result;
	} else if (typeof result === "object" && result !== null) {
		const r = result as Record<string, unknown>;
		if (Array.isArray(r.content)) {
			text = (r.content as Array<Record<string, unknown>>)
				.filter((c) => c.type === "text" && typeof c.text === "string")
				.map((c) => c.text as string)
				.join("\n");
		} else if (typeof r.text === "string") {
			text = r.text;
		} else if (typeof r.stdout === "string") {
			text = [r.stdout, r.stderr].filter(Boolean).join("\n");
		} else {
			return [];
		}
	} else {
		return [];
	}
	if (!text.trim()) return [];
	const allLines = text.split("\n");
	const MAX_LINES = 15;
	if (allLines.length <= MAX_LINES) return allLines;
	return [...allLines.slice(0, MAX_LINES), `... (${allLines.length - MAX_LINES} more lines)`];
}

function truncate(s: string, max: number): string {
	const firstLine = s.split("\n")[0];
	return firstLine.length > max ? firstLine.slice(0, max - 3) + "..." : firstLine;
}

const ToolMessageView = memo(function ToolMessageView({ message }: { message: Message }) {
	if (!message.toolName) return null;

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

	const { label, lines } = formatToolDetail(message.toolName, message.toolArgs);
	const resultLines =
		message.toolName !== "read" && (message.toolStatus === "done" || message.toolStatus === "error")
			? formatToolResult(message.toolResult)
			: [];

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
			<box flexDirection="row" paddingLeft={1} paddingRight={1} paddingTop={0} paddingBottom={0}>
				<text fg={statusFg}>{icon} </text>
				<text fg={colors.secondary}>{label}</text>
			</box>
			{lines.length > 0 && (
				<box flexDirection="column" paddingLeft={3} paddingRight={1} paddingBottom={0}>
					{lines.map((line, i) => (
						<text
							key={i}
							fg={
								line.startsWith("-")
									? colors.error
									: line.startsWith("+")
										? colors.success
										: colors.textSubtle
							}
						>
							{line}
						</text>
					))}
				</box>
			)}
			{resultLines.length > 0 && (
				<box
					flexDirection="column"
					paddingLeft={3}
					paddingRight={1}
					paddingBottom={0}
					marginTop={0}
				>
					{resultLines.map((line, i) => (
						<text key={i} fg={message.toolStatus === "error" ? colors.error : colors.textMuted}>
							{line}
						</text>
					))}
				</box>
			)}
		</box>
	);
});

const ReadGroupView = memo(function ReadGroupView({ reads }: { reads: Message[] }) {
	const allRunning = reads.every((r) => r.toolStatus === "running");
	const hasError = reads.some((r) => r.toolStatus === "error");

	const borderColor = allRunning
		? colors.borderActive
		: hasError
			? colors.error
			: colors.borderSoft;

	const headerIcon = allRunning ? icons.toolRunning : hasError ? icons.toolError : icons.toolDone;
	const headerFg = allRunning ? colors.textMuted : hasError ? colors.error : colors.success;

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
				<text fg={headerFg}>{headerIcon} </text>
				<text fg={colors.secondary}>read</text>
				<text fg={colors.textSubtle}> · {reads.length} files · </text>
				<text fg={colors.textMuted}>R to view</text>
			</box>
			{reads.map((msg, i) => {
				const info = extractReadInfo(msg);
				const statusIcon =
					msg.toolStatus === "running" ? "○" : msg.toolStatus === "error" ? "✗" : "✓";
				const statusFg =
					msg.toolStatus === "running"
						? colors.textMuted
						: msg.toolStatus === "error"
							? colors.error
							: colors.success;
				return (
					<box key={msg.id} flexDirection="row" paddingLeft={2} paddingRight={1}>
						<text fg={colors.textSubtle}>[{i + 1}] </text>
						<text fg={statusFg}>{statusIcon} </text>
						<text fg={colors.textSubtle}>
							{info.shortPath}
							{info.range ?? ""}
						</text>
					</box>
				);
			})}
		</box>
	);
});

const SeparatorView = memo(function SeparatorView() {
	return (
		<box marginTop={1} flexShrink={0}>
			<box border={["top"]} borderColor={colors.borderActive} />
		</box>
	);
});

type RenderItem =
	| { type: "single"; message: Message; index: number }
	| { type: "readGroup"; messages: Message[]; startIndex: number };

function groupMessages(messages: Message[]): RenderItem[] {
	const items: RenderItem[] = [];
	let readBuf: Message[] = [];
	let readStart = 0;

	const flush = () => {
		if (readBuf.length === 0) return;
		if (readBuf.length === 1) {
			items.push({ type: "single", message: readBuf[0], index: readStart });
		} else {
			items.push({ type: "readGroup", messages: [...readBuf], startIndex: readStart });
		}
		readBuf = [];
	};

	for (let i = 0; i < messages.length; i++) {
		const msg = messages[i];
		if (msg.role === "tool" && msg.toolName === "read") {
			if (readBuf.length === 0) readStart = i;
			readBuf.push(msg);
		} else {
			flush();
			items.push({ type: "single", message: msg, index: i });
		}
	}
	flush();

	return items;
}

export function getReadEntries(messages: Message[]): ReadEntry[] {
	return messages.filter((m) => m.role === "tool" && m.toolName === "read").map(extractReadInfo);
}

export function MessageList({
	messages,
	scrollRef,
	thinkingCollapsed,
}: {
	messages: Message[];
	scrollRef?: { current: ScrollBoxRenderable | null };
	thinkingCollapsed?: boolean;
}) {
	const items = groupMessages(messages);
	return (
		<scrollbox
			ref={scrollRef}
			flexGrow={1}
			scrollY
			stickyScroll
			stickyStart="bottom"
			focused={false}
		>
			<box flexDirection="column" paddingLeft={2} paddingRight={2} paddingBottom={1}>
				<box height={1} />
				{items.map((item, i) => {
					if (item.type === "readGroup") {
						return <ReadGroupView key={i} reads={item.messages} />;
					}
					const msg = item.message;
					if (msg.role === "separator") return <SeparatorView key={msg.id} />;
					if (msg.role === "user")
						return <UserMessageView key={msg.id} message={msg} index={item.index} />;
					if (msg.role === "tool") return <ToolMessageView key={msg.id} message={msg} />;
					return (
						<AssistantMessageView
							key={msg.id}
							message={msg}
							thinkingCollapsed={thinkingCollapsed}
						/>
					);
				})}
			</box>
		</scrollbox>
	);
}
