import type { KeyEvent, KeyBinding as TextareaKeyBinding, TextareaRenderable } from "@opentui/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentMode } from "../../agent/session.js";
import type { SkillListEntry } from "../../client/types.js";
import type { PollManager } from "../../poll/manager.js";
import { usePollState } from "../../poll/usePollState.js";
import type { MemberState } from "../../teams/types-v2.js";
import { matchSuggestions, type SuggestionItem } from "../commands.js";
import type { Mode } from "../keymap.js";
import { colors, icons } from "../utils/theme.js";
import { TeamStatusBar } from "./TeamStatusBar.js";

interface InputBoxProps {
	disabled: boolean;
	mode: Mode;
	agentMode: AgentMode;
	model: string;
	cwd: string;
	pollManager: PollManager;
	skills: readonly SkillListEntry[] | null;
	onSubmit: (text: string) => void;
	sentMessages: string[];
	pendingInput?: { text: string; nonce: number } | null;
	members?: MemberState[];
	activeMemberName?: string | null;
}

export function InputBox({
	disabled,
	mode,
	agentMode,
	model,
	cwd,
	pollManager,
	skills,
	onSubmit,
	sentMessages,
	pendingInput,
	members = [],
	activeMemberName = null,
}: InputBoxProps) {
	const [inputHeight, setInputHeight] = useState(2);
	const [animationFrame, setAnimationFrame] = useState(0);
	const [currentText, setCurrentText] = useState("");
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [historyIndex, setHistoryIndex] = useState(-1);
	const [savedDraft, setSavedDraft] = useState<string | null>(null);
	const isHistoryNavRef = useRef(false);
	const textareaRef = useRef<TextareaRenderable | null>(null);
	const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
	const workingSuffix = ["   ", ".  ", ".. ", "..."];

	const branch = usePollState<string>("git-branch", pollManager);
	const dirty = usePollState<boolean>("git-dirty", pollManager);
	const gitColor = dirty ? colors.warning : colors.success;
	const mcpStatusRaw = usePollState<string>("mcp-status", pollManager);
	const mcpInfo = useMemo(() => {
		if (!mcpStatusRaw) return null;
		const [totalStr, hasFailedStr] = mcpStatusRaw.split(":");
		const total = Number(totalStr);
		if (!total || total <= 0) return null;
		return { total, hasFailed: hasFailedStr === "true" };
	}, [mcpStatusRaw]);
	const pathDisplay = useMemo(() => {
		const parts = cwd
			.replace(process.env.HOME ?? "", "~")
			.split("/")
			.filter(Boolean);
		return parts.length > 3 ? `…/${parts[parts.length - 1]}` : parts.join("/");
	}, [cwd]);

	const isSlashMode = currentText.startsWith("/");
	const suggestions = useMemo<SuggestionItem[]>(
		() => (isSlashMode ? matchSuggestions(currentText, skills) : []),
		[isSlashMode, currentText, skills],
	);
	const showSuggestions = isSlashMode && suggestions.length > 0 && mode === "insert";

	useEffect(() => {
		if (selectedIndex >= suggestions.length) {
			setSelectedIndex(0);
		}
	}, [suggestions.length, selectedIndex]);

	useEffect(() => {
		if (!pendingInput) return;
		const ta = textareaRef.current;
		if (ta) {
			ta.setText(pendingInput.text);
			ta.gotoBufferEnd();
		}
		setCurrentText(pendingInput.text);
		const nextHeight = Math.min(6, Math.max(2, pendingInput.text.split("\n").length));
		setInputHeight(nextHeight);
		setSelectedIndex(0);
		setHistoryIndex(-1);
		setSavedDraft(null);
	}, [pendingInput]);

	const keyBindings = useMemo<TextareaKeyBinding[]>(
		() => [
			{ name: "return", action: "submit" },
			{ name: "kpenter", action: "submit" },
			{ name: "return", shift: true, action: "newline" },
			{ name: "kpenter", shift: true, action: "newline" },
			{ name: "return", ctrl: true, action: "submit" },
			{ name: "kpenter", ctrl: true, action: "submit" },
			{ name: "return", meta: true, action: "submit" },
			{ name: "kpenter", meta: true, action: "submit" },
		],
		[],
	);

	const handleSubmit = useCallback(
		(submitted: string) => {
			const trimmed = submitted.trim();
			if (!trimmed) return;
			onSubmit(trimmed);
		},
		[onSubmit],
	);

	const syncTextareaState = useCallback(() => {
		const nextValue = textareaRef.current?.plainText ?? "";
		const nextHeight = Math.min(6, Math.max(2, nextValue.split("\n").length));
		setInputHeight(nextHeight);
		return nextValue;
	}, []);

	const handleContentChange = useCallback(() => {
		const text = syncTextareaState();
		setCurrentText(text);
		setSelectedIndex(0);
		if (!isHistoryNavRef.current && historyIndex !== -1) {
			setHistoryIndex(-1);
			setSavedDraft(null);
		}
		isHistoryNavRef.current = false;
	}, [syncTextareaState, historyIndex]);

	const handleTextareaSubmit = useCallback(() => {
		const currentValue = syncTextareaState();
		if (showSuggestions && suggestions.length > 0) {
			const cmd = suggestions[Math.min(selectedIndex, suggestions.length - 1)];
			if (textareaRef.current) {
				textareaRef.current.setText(`/${cmd.name} `);
				textareaRef.current.gotoBufferEnd();
			}
			setCurrentText(`/${cmd.name} `);
			setSelectedIndex(0);
			return;
		}
		handleSubmit(currentValue);
		if (textareaRef.current) {
			textareaRef.current.clear();
		}
		setCurrentText("");
		setSelectedIndex(0);
		setInputHeight(2);
	}, [handleSubmit, syncTextareaState, selectedIndex, suggestions, showSuggestions]);

	const handleKeyDown = useCallback(
		(key: KeyEvent) => {
			if (showSuggestions) {
				if (key.name === "up") {
					setSelectedIndex((i) => Math.max(0, i - 1));
				} else if (key.name === "down") {
					setSelectedIndex((i) => Math.min(suggestions.length - 1, i + 1));
				} else if (key.name === "tab") {
					const cmd = suggestions[selectedIndex];
					if (cmd && textareaRef.current) {
						textareaRef.current.setText(`/${cmd.name} `);
						textareaRef.current.gotoBufferEnd();
						setCurrentText(`/${cmd.name} `);
					}
				}
				return;
			}

			if (sentMessages.length === 0) return;

			if (key.name === "up") {
				if (historyIndex === -1) {
					setSavedDraft(currentText);
					const idx = sentMessages.length - 1;
					isHistoryNavRef.current = true;
					setHistoryIndex(idx);
					textareaRef.current?.setText(sentMessages[idx]);
					setCurrentText(sentMessages[idx]);
				} else if (historyIndex > 0) {
					const idx = historyIndex - 1;
					isHistoryNavRef.current = true;
					setHistoryIndex(idx);
					textareaRef.current?.setText(sentMessages[idx]);
					setCurrentText(sentMessages[idx]);
				}
			} else if (key.name === "down") {
				if (historyIndex === -1) return;
				if (historyIndex < sentMessages.length - 1) {
					const idx = historyIndex + 1;
					isHistoryNavRef.current = true;
					setHistoryIndex(idx);
					textareaRef.current?.setText(sentMessages[idx]);
					setCurrentText(sentMessages[idx]);
				} else {
					isHistoryNavRef.current = true;
					setHistoryIndex(-1);
					const restore = savedDraft ?? "";
					textareaRef.current?.setText(restore);
					setCurrentText(restore);
					setSavedDraft(null);
				}
			}
		},
		[
			showSuggestions,
			suggestions,
			selectedIndex,
			sentMessages,
			historyIndex,
			savedDraft,
			currentText,
		],
	);

	useEffect(() => {
		if (!disabled) {
			setAnimationFrame(0);
			return;
		}

		const interval = setInterval(() => {
			setAnimationFrame((frame) => frame + 1);
		}, 120);

		return () => clearInterval(interval);
	}, [disabled]);

	const modeLabel =
		agentMode === "planner"
			? "planner"
			: agentMode === "orchestrator"
				? "orchestrator"
				: agentMode === "team"
					? "team"
					: "code";
	const modeColor =
		agentMode === "planner"
			? colors.warning
			: agentMode === "orchestrator"
				? colors.accent
				: agentMode === "team"
					? colors.success
					: colors.secondary;

	return (
		<box flexDirection="column" flexShrink={0}>
			{showSuggestions && (
				<box flexDirection="column" paddingLeft={2} paddingRight={2} flexShrink={0}>
					{suggestions.map((cmd, i) => (
						<box key={cmd.name} flexDirection="row">
							<text fg={i === selectedIndex ? colors.primary : colors.textSubtle}>
								{i === selectedIndex ? "▶ " : "  "}
							</text>
							<text fg={i === selectedIndex ? colors.secondary : colors.text}>/{cmd.name}</text>
							<text fg={colors.textMuted}> {cmd.description}</text>
						</box>
					))}
				</box>
			)}
			<box height={1} flexDirection="row" paddingLeft={2} paddingRight={2}>
				{disabled && (
					<>
						<text fg={colors.textMuted}>
							{spinnerFrames[animationFrame % spinnerFrames.length]}{" "}
						</text>
						<text fg={colors.textMuted}>
							{`Working${workingSuffix[animationFrame % workingSuffix.length]}`}
						</text>
					</>
				)}
			</box>
			<TeamStatusBar members={members} activeMemberName={activeMemberName} />
			<box height={1} flexDirection="row" paddingLeft={2} paddingRight={2}>
				<text fg={modeColor}>{modeLabel}</text>
				<text fg={colors.textSubtle}>{" · "}</text>
				<text fg={colors.textSubtle}>{model}</text>
				<text fg={colors.textSubtle}>{" · "}</text>
				<text fg={colors.textSubtle}>{pathDisplay}</text>
				{branch ? (
					<>
						<text fg={colors.textSubtle}>{" · "}</text>
						<text fg={gitColor}>{branch}</text>
					</>
				) : null}
				{mcpInfo ? (
					<>
						<text fg={colors.textSubtle}>{" · "}</text>
						<text fg={mcpInfo.hasFailed ? colors.error : colors.success}>
							{`⊙ ${mcpInfo.total} MCP`}
						</text>
					</>
				) : null}
				<box flexGrow={1} />
			</box>
			<box borderStyle="single" border={["top"]} borderColor={colors.borderDim}>
				<box
					flexDirection="row"
					paddingLeft={2}
					paddingRight={2}
					paddingTop={1}
					paddingBottom={1}
					backgroundColor={colors.backgroundInset}
					alignItems="flex-start"
				>
					<text
						width={2}
						fg={
							mode === "insert" ? (disabled ? colors.textMuted : colors.primary) : colors.textMuted
						}
					>
						{icons.user}
					</text>
					<textarea
						ref={textareaRef}
						initialValue=""
						focused={mode === "insert"}
						height={inputHeight}
						minHeight={2}
						maxHeight={6}
						flexGrow={1}
						wrapMode="word"
						backgroundColor={colors.backgroundInset}
						focusedBackgroundColor={colors.backgroundInset}
						textColor={colors.text}
						focusedTextColor={colors.text}
						cursorColor={colors.primary}
						placeholderColor={colors.textSubtle}
						placeholder={disabled ? "Queue a message…" : mode === "insert" ? "" : "Press i to type"}
						keyBindings={keyBindings}
						onKeyDown={handleKeyDown}
						onContentChange={handleContentChange}
						onSubmit={handleTextareaSubmit}
					/>
				</box>
			</box>
		</box>
	);
}
