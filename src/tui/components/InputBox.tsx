import type { KeyEvent, KeyBinding as TextareaKeyBinding, TextareaRenderable } from "@opentui/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentMode } from "../../agent/session.js";
import type { PollManager } from "../../poll/manager.js";
import { usePollState } from "../../poll/usePollState.js";
import { matchCommands } from "../commands.js";
import type { Mode } from "../keymap.js";
import { colors, icons } from "../utils/theme.js";

interface InputBoxProps {
	disabled: boolean;
	mode: Mode;
	agentMode: AgentMode;
	cwd: string;
	pollManager: PollManager;
	onSubmit: (text: string) => void;
	sentMessages: string[];
}

export function InputBox({
	disabled,
	mode,
	agentMode,
	cwd,
	pollManager,
	onSubmit,
	sentMessages,
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
	const pathDisplay = useMemo(() => {
		const parts = cwd
			.replace(process.env.HOME ?? "", "~")
			.split("/")
			.filter(Boolean);
		return parts.length > 3 ? `…/${parts[parts.length - 1]}` : parts.join("/");
	}, [cwd]);

	const isSlashMode = currentText.startsWith("/");
	const suggestions = useMemo(
		() => (isSlashMode ? matchCommands(currentText) : []),
		[isSlashMode, currentText],
	);
	const showSuggestions = isSlashMode && suggestions.length > 0 && mode === "insert";

	useEffect(() => {
		if (selectedIndex >= suggestions.length) {
			setSelectedIndex(0);
		}
	}, [suggestions.length, selectedIndex]);

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
	}, [syncTextareaState, historyIndex]);

	const handleTextareaSubmit = useCallback(() => {
		const currentValue = syncTextareaState();
		if (currentValue.startsWith("/")) {
			const matched = matchCommands(currentValue);
			if (matched.length > 0) {
				const cmd = matched[Math.min(selectedIndex, matched.length - 1)];
				handleSubmit(`/${cmd.name}`);
			} else {
				handleSubmit(currentValue);
			}
		} else {
			handleSubmit(currentValue);
		}
		if (textareaRef.current) {
			textareaRef.current.clear();
		}
		setCurrentText("");
		setSelectedIndex(0);
		setInputHeight(2);
	}, [handleSubmit, syncTextareaState, selectedIndex]);

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
						setCurrentText(`/${cmd.name} `);
					}
				}
				return;
			}

			if (sentMessages.length === 0) return;
			isHistoryNavRef.current = true;

			if (key.name === "up") {
				if (historyIndex === -1) {
					setSavedDraft(currentText);
					const idx = sentMessages.length - 1;
					setHistoryIndex(idx);
					textareaRef.current?.setText(sentMessages[idx]);
					setCurrentText(sentMessages[idx]);
				} else if (historyIndex > 0) {
					const idx = historyIndex - 1;
					setHistoryIndex(idx);
					textareaRef.current?.setText(sentMessages[idx]);
					setCurrentText(sentMessages[idx]);
				}
			} else if (key.name === "down") {
				if (historyIndex === -1) {
					isHistoryNavRef.current = false;
					return;
				}
				if (historyIndex < sentMessages.length - 1) {
					const idx = historyIndex + 1;
					setHistoryIndex(idx);
					textareaRef.current?.setText(sentMessages[idx]);
					setCurrentText(sentMessages[idx]);
				} else {
					setHistoryIndex(-1);
					const restore = savedDraft ?? "";
					textareaRef.current?.setText(restore);
					setCurrentText(restore);
					setSavedDraft(null);
				}
			}

			isHistoryNavRef.current = false;
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
			{disabled && (
				<box height={1} flexDirection="row" paddingLeft={1} paddingRight={1}>
					<text fg={colors.warning}>{spinnerFrames[animationFrame % spinnerFrames.length]} </text>
					<text fg={colors.text}>
						{`Working${workingSuffix[animationFrame % workingSuffix.length]}`}
					</text>
				</box>
			)}
			<box
				height={1}
				flexDirection="row"
				paddingLeft={1}
				paddingRight={1}
				marginTop={disabled ? 1 : 0}
			>
				<text fg={colors.textMuted}>{icons.folder} </text>
				<text fg={colors.textMuted}>
					{pathDisplay}
					{branch ? ":" : ""}
				</text>
				{branch ? <text fg={gitColor}>{branch}</text> : null}
				{agentMode === "planner" && <text fg={colors.warning}> ⏸ planner</text>}
				<box flexGrow={1} />
			</box>
			<box
				borderStyle="rounded"
				border={["top", "right", "bottom", "left"]}
				borderColor={mode === "insert" ? colors.borderActive : colors.borderSoft}
			>
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
						placeholderColor={colors.textMuted}
						placeholder={
							disabled
								? "Queue a message…"
								: mode === "insert"
									? "Message openagent…  / for commands"
									: "Press i to type"
						}
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
