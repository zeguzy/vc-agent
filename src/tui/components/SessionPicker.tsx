import { useKeyboard } from "@opentui/react";
import { useMemo, useRef, useState } from "react";
import type { SessionInfo } from "../../session/list.js";
import { colors } from "../utils/theme.js";

interface SessionPickerProps {
	sessions: SessionInfo[];
	currentId?: string;
	onSelect: (path: string) => void;
	onClose: () => void;
	onRename: (path: string, name: string) => void;
}

const VISIBLE_LIMIT = 20;

function isPrintable(name: string | undefined): name is string {
	return !!name && name.length === 1 && /[a-z0-9 _./-]/i.test(name);
}

function matches(info: SessionInfo, query: string): boolean {
	if (!query) return true;
	const q = query.toLowerCase();
	return (
		(info.name?.toLowerCase().includes(q) ?? false) ||
		info.firstMessage.toLowerCase().includes(q) ||
		info.id.toLowerCase().includes(q)
	);
}

function describe(info: SessionInfo): string {
	return info.name?.trim() || info.firstMessage.trim() || "(empty session)";
}

export function SessionPicker({
	sessions,
	currentId,
	onSelect,
	onClose,
	onRename,
}: SessionPickerProps) {
	const [query, setQuery] = useState("");
	const [selectedIdx, setSelectedIdx] = useState(0);
	const [renaming, setRenaming] = useState(false);
	const [renameText, setRenameText] = useState("");

	const queryRef = useRef(query);
	queryRef.current = query;
	const renamingRef = useRef(renaming);
	renamingRef.current = renaming;
	const renameTextRef = useRef(renameText);
	renameTextRef.current = renameText;
	const renamePathRef = useRef<string>("");
	const onSelectRef = useRef(onSelect);
	onSelectRef.current = onSelect;
	const onCloseRef = useRef(onClose);
	onCloseRef.current = onClose;
	const onRenameRef = useRef(onRename);
	onRenameRef.current = onRename;

	const filtered = useMemo(() => sessions.filter((s) => matches(s, query)), [sessions, query]);
	const filteredRef = useRef(filtered);
	filteredRef.current = filtered;
	const cur = Math.min(selectedIdx, Math.max(0, filtered.length - 1));
	const curRef = useRef(cur);
	curRef.current = cur;

	useKeyboard((key) => {
		if (renamingRef.current) {
			if (key.name === "return") {
				const text = renameTextRef.current.trim();
				const path = renamePathRef.current;
				setRenaming(false);
				if (text && path) onRenameRef.current(path, text);
			} else if (key.name === "escape") {
				setRenaming(false);
			} else if (key.name === "backspace") {
				setRenameText((t) => t.slice(0, -1));
			} else if (isPrintable(key.name)) {
				setRenameText((t) => t + key.name);
			}
			return;
		}

		const list = filteredRef.current;
		const idx = curRef.current;

		if (key.name === "up" || key.name === "k") {
			setSelectedIdx(Math.max(0, idx - 1));
		} else if (key.name === "down" || key.name === "j") {
			setSelectedIdx(Math.min(list.length - 1, idx + 1));
		} else if (key.name === "return") {
			const target = list[idx];
			if (target) onSelectRef.current(target.path);
		} else if (key.name === "escape") {
			onCloseRef.current();
		} else if (key.ctrl && (key.name === "r" || key.name === "R")) {
			const target = list[idx];
			if (target) {
				renamePathRef.current = target.path;
				setRenameText(target.name ?? target.firstMessage.slice(0, 40));
				setRenaming(true);
			}
		} else if (key.name === "backspace") {
			setQuery((q) => q.slice(0, -1));
		} else if (isPrintable(key.name)) {
			setQuery((q) => q + key.name);
			setSelectedIdx(0);
		}
	});

	return (
		<box flexShrink={0} paddingLeft={1} paddingRight={1} paddingBottom={1}>
			<box
				borderStyle="rounded"
				border={["top", "right", "bottom", "left"]}
				borderColor={colors.borderActive}
				backgroundColor={colors.backgroundInset}
				flexDirection="column"
				paddingLeft={1}
				paddingRight={1}
			>
				<box flexDirection="row">
					<text fg={colors.primary}>Sessions</text>
					<text fg={colors.textMuted}> ↑↓ navigate · Enter switch · Ctrl+R rename · Esc close</text>
				</box>
				<box flexDirection="row">
					<text fg={colors.textMuted}>search: </text>
					<text fg={colors.text}>{query || " "}</text>
				</box>
				{renaming && (
					<box flexDirection="row">
						<text fg={colors.secondary}>rename: </text>
						<text fg={colors.text}>{renameText}</text>
					</box>
				)}
				<box flexDirection="column">
					{filtered.length === 0 ? (
						<text fg={colors.textMuted}>{query ? "无匹配会话" : "当前目录暂无会话"}</text>
					) : (
						filtered.slice(0, VISIBLE_LIMIT).map((s, i) => {
							const isSelected = i === cur;
							const isCurrent = s.id === currentId;
							return (
								<box key={s.path} flexDirection="row">
									<text fg={isSelected ? colors.secondary : colors.textSubtle}>
										{isSelected ? "▶ " : "  "}
									</text>
									<text fg={isCurrent ? colors.primary : colors.textSubtle}>
										{isCurrent ? "● " : "  "}
									</text>
									<text
										fg={isSelected ? colors.secondary : isCurrent ? colors.primary : colors.text}
									>
										{describe(s).slice(0, 50)}
									</text>
									<text fg={colors.textMuted}> · {s.messageCount} msgs</text>
								</box>
							);
						})
					)}
				</box>
				{filtered.length > VISIBLE_LIMIT && (
					<text fg={colors.textSubtle}>
						… ({filtered.length - VISIBLE_LIMIT} more, refine search)
					</text>
				)}
			</box>
		</box>
	);
}
