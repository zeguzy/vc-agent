import type { ScrollBoxRenderable } from "@opentui/core";
import { memo, useEffect, useState } from "react";
import type { Message } from "../../message.js";
import { syntaxStyle } from "../utils/syntax.js";
import { colors, icons } from "../utils/theme.js";
import { EditDiffView } from "./EditDiffView.js";

function workerStatusIcon(status: Message["workerStatus"]): string {
	switch (status) {
		case "running":
			return "◌";
		case "done":
			return "✓";
		case "error":
			return "✗";
		case "cancelled":
			return "⊘";
		default:
			return "?";
	}
}

function workerStatusColor(status: Message["workerStatus"]): string {
	switch (status) {
		case "running":
			return colors.warning;
		case "done":
			return colors.success;
		case "error":
			return colors.error;
		case "cancelled":
			return colors.textMuted;
		default:
			return colors.textSubtle;
	}
}

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

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;
const SPINNER_INTERVAL_MS = 80;

const ThinkingSpinner = memo(function ThinkingSpinner({ fg }: { fg: string }) {
	const [frame, setFrame] = useState(0);
	useEffect(() => {
		const id = setInterval(() => {
			setFrame((v) => (v + 1) % SPINNER_FRAMES.length);
		}, SPINNER_INTERVAL_MS);
		return () => clearInterval(id);
	}, []);
	return <text fg={fg}>{`${SPINNER_FRAMES[frame]} `}</text>;
});

const AssistantMessageView = memo(function AssistantMessageView({
	message,
	thinkingCollapsed,
}: {
	message: Message;
	thinkingCollapsed?: boolean;
}) {
	const hasThinking = message.thinking?.trim();
	const collapsed = thinkingCollapsed && hasThinking;
	return (
		<box paddingLeft={3} marginTop={1} flexShrink={0} flexDirection="column">
			{hasThinking && (
				<box flexDirection="column" flexShrink={0}>
					<box flexDirection="row">
						<text fg={colors.warning}>{collapsed ? "+ " : "- "}</text>
						{message.thinkingStreaming ? <ThinkingSpinner fg={colors.warning} /> : null}
						<text fg={colors.warning}>
							{message.thinkingStreaming ? "thinking" : "through"}
							{collapsed ? " …" : ""}
						</text>
					</box>
					{!collapsed && (
						<box flexDirection="column" marginTop={0}>
							{message.thinking
								?.split("\n")
								.filter((l) => l.trim())
								// biome-ignore lint/suspicious/noArrayIndexKey: split text lines have no stable IDs
								.map((line, i) => (
									<text key={`think-${message.id}-${i}`} fg={colors.textSubtle}>
										{line}
									</text>
								))}
						</box>
					)}
				</box>
			)}
			{message.content && (
				<box marginTop={hasThinking && !collapsed ? 1 : 0} flexDirection="column">
					<markdown
						id={`md-${message.id}`}
						syntaxStyle={syntaxStyle}
						streaming={true}
						internalBlockMode="top-level"
						tableOptions={{ style: "grid" }}
						content={message.content}
						fg={colors.markdownText}
						bg={colors.background}
					/>
				</box>
			)}
		</box>
	);
});

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
			return { label: "bash", lines: [cmd.length > 100 ? `${cmd.slice(0, 97)}...` : cmd] };
		}
		case "edit": {
			return { label: "edit", lines: [] };
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
		case "lsp": {
			const action = String(a.action ?? "");
			const fp = a.file ? String(a.file) : undefined;
			const lines: string[] = [action];
			if (fp) lines.push(fp);
			if (a.line != null) lines.push(`line: ${a.line}`);
			if (a.symbol) lines.push(`symbol: ${a.symbol}`);
			if (a.query) lines.push(`query: ${a.query}`);
			if (a.new_name) lines.push(`→ ${a.new_name}`);
			if (a.apply === true) lines.push("apply");
			if (a.index != null) lines.push(`index: ${a.index}`);
			return { label: "lsp", lines };
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

function getEditPatch(message: Message): string | undefined {
	const result = message.toolResult;
	if (!result || typeof result !== "object") return undefined;
	const details = (result as Record<string, unknown>).details;
	if (!details || typeof details !== "object") return undefined;
	const patch = (details as Record<string, unknown>).patch;
	return typeof patch === "string" && patch.length > 0 ? patch : undefined;
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
	const editPatch = message.toolName === "edit" ? getEditPatch(message) : undefined;
	const editFilePath =
		message.toolName === "edit"
			? String(((message.toolArgs as Record<string, unknown>) ?? {}).path ?? "")
			: "";
	const resultLines =
		message.toolName !== "read" &&
		!editPatch &&
		(message.toolStatus === "done" || message.toolStatus === "error")
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
				{editFilePath && <text fg={colors.textMuted}> {editFilePath}</text>}
			</box>
			{lines.length > 0 && (
				<box flexDirection="column" paddingLeft={3} paddingRight={1} paddingBottom={0}>
					{
						// biome-ignore lint/suspicious/noArrayIndexKey: diff lines have no stable IDs
						lines.map((line, i) => (
							<text
								key={`diff-${i}`}
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
						))
					}
				</box>
			)}
			{editPatch && (
				<box paddingLeft={1} paddingRight={1} paddingTop={1} paddingBottom={1}>
					<EditDiffView patch={editPatch} filePath={editFilePath} />
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
					{
						// biome-ignore lint/suspicious/noArrayIndexKey: tool result lines have no stable IDs
						resultLines.map((line, i) => (
							<text
								key={`result-${i}`}
								fg={message.toolStatus === "error" ? colors.error : colors.textMuted}
							>
								{line}
							</text>
						))
					}
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

const TodoMessageView = memo(function TodoMessageView({ message }: { message: Message }) {
	if (message.toolStatus === "running") {
		return (
			<box marginTop={1} paddingLeft={2} flexShrink={0}>
				<text fg={colors.textMuted}>⚙ Updating todos...</text>
			</box>
		);
	}
	const args = (message.toolArgs ?? {}) as {
		todos?: Array<{ content: string; status: string }>;
	};
	const todos = args.todos ?? [];
	return (
		<box
			border={["left"]}
			borderColor={colors.borderSoft}
			backgroundColor={colors.backgroundPanel}
			marginTop={1}
			paddingTop={1}
			paddingBottom={1}
			paddingLeft={2}
			flexShrink={0}
			flexDirection="column"
		>
			<text fg={colors.textMuted}># Todos</text>
			<box height={1} />
			<box flexDirection="column">
				{todos.map((t, i) => {
					const ch = t.status === "completed" ? "✓" : t.status === "in_progress" ? "•" : " ";
					const fg = t.status === "in_progress" ? colors.warning : colors.textMuted;
					return (
						<box key={`todo-${i}`} flexDirection="row">
							<text fg={fg}>{`[${ch}] `}</text>
							<text fg={fg}>{t.content}</text>
						</box>
					);
				})}
			</box>
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

const WorkerMessageView = memo(function WorkerMessageView({ message }: { message: Message }) {
	const statusColor = workerStatusColor(message.workerStatus);
	const statusIcon = workerStatusIcon(message.workerStatus);
	return (
		<box
			borderStyle="rounded"
			border={["top", "right", "bottom", "left"]}
			borderColor={colors.borderSoft}
			marginTop={1}
			flexShrink={0}
			flexDirection="column"
		>
			<box
				backgroundColor={colors.backgroundPanel}
				paddingLeft={1}
				paddingRight={1}
				flexDirection="row"
			>
				<text fg={statusColor}>{statusIcon} </text>
				<text fg={colors.textMuted}>{message.workerId?.slice(0, 10)}</text>
				<text fg={colors.textSubtle}>/{message.workerAgent} </text>
				<text fg={statusColor}>{message.workerStatus}</text>
			</box>
			{message.content && (
				<box paddingLeft={3} paddingRight={1} flexDirection="column">
					<markdown
						id={`md-${message.id}`}
						syntaxStyle={syntaxStyle}
						streaming={true}
						content={message.content}
						fg={colors.markdownText}
						bg={colors.background}
					/>
				</box>
			)}
		</box>
	);
});

const WorkerSummaryView = memo(function WorkerSummaryView({ message }: { message: Message }) {
	const statusColor = workerStatusColor(message.workerStatus);
	const statusIcon = workerStatusIcon(message.workerStatus);
	const summary = message.content.slice(0, 100) + (message.content.length > 100 ? "…" : "");
	const costStr = message.workerCost ? ` $${message.workerCost.toFixed(4)}` : "";
	return (
		<box paddingLeft={3} marginTop={1} flexShrink={0} flexDirection="column">
			<box flexDirection="row">
				<text fg={statusColor}>{statusIcon} </text>
				<text fg={colors.textMuted}>{message.workerId?.slice(0, 10)}</text>
				<text fg={colors.textSubtle}>/{message.workerAgent} </text>
				<text fg={statusColor}>{message.workerStatus}</text>
				<text fg={colors.textMuted}>{costStr}</text>
				{summary && (
					<>
						<text fg={colors.textSubtle}> — </text>
						<text fg={colors.textSubtle}>{summary}</text>
					</>
				)}
			</box>
			{message.workerError && (
				<box paddingLeft={3} flexDirection="row">
					<text fg={colors.error}>↳ {message.workerError}</text>
				</box>
			)}
		</box>
	);
});

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
				{items.map((item, i, arr) => {
					if (item.type === "readGroup") {
						return <ReadGroupView key={`rg-${item.startIndex}`} reads={item.messages} />;
					}
					const msg = item.message;
					if (msg.role === "separator") {
						if (i === arr.length - 1) return null;
						return <SeparatorView key={msg.id} />;
					}
					if (msg.role === "user")
						return <UserMessageView key={msg.id} message={msg} index={item.index} />;
					if (msg.role === "tool") {
						if (msg.toolName === "todo") return <TodoMessageView key={msg.id} message={msg} />;
						return <ToolMessageView key={msg.id} message={msg} />;
					}
					if (msg.role === "worker") return <WorkerMessageView key={msg.id} message={msg} />;
					if (msg.role === "worker-summary")
						return <WorkerSummaryView key={msg.id} message={msg} />;
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
