import type { KeyEvent, TextareaRenderable } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useRef, useState } from "react";
import type { EditConfirmBridge, EditConfirmDecision } from "../../tools/edit-confirm-bridge.js";
import { useTerminalWidth } from "../hooks/useTerminalWidth.js";
import { pathToFiletype } from "../utils/filetype.js";
import { syntaxStyle } from "../utils/syntax.js";
import { colors } from "../utils/theme.js";

interface DiffConfirmBoxProps {
	bridge: EditConfirmBridge;
	onDecision: (decision: EditConfirmDecision) => void;
}

type Phase = "choose" | "reject-feedback";

export function DiffConfirmBox({ bridge, onDecision }: DiffConfirmBoxProps) {
	const pending = bridge.pending;
	const width = useTerminalWidth();
	const [cursor, setCursor] = useState(0);
	const [phase, setPhase] = useState<Phase>("choose");
	const textareaRef = useRef<TextareaRenderable | null>(null);

	useKeyboard((key: KeyEvent) => {
		if (phase === "reject-feedback") {
			if (key.name === "escape") {
				setPhase("choose");
			}
			return;
		}
		switch (key.name) {
			case "left":
				setCursor((c) => (c === 0 ? 1 : 0));
				break;
			case "right":
			case "tab":
				setCursor((c) => (c === 0 ? 1 : 0));
				break;
			case "return":
			case "kpenter":
				if (cursor === 0) {
					onDecision({ kind: "accept" });
				} else {
					setPhase("reject-feedback");
				}
				break;
			case "escape":
				onDecision({ kind: "reject", feedback: "" });
				break;
		}
	});

	if (!pending) return null;

	const filetype = pathToFiletype(pending.filePath);

	const handleFeedbackSubmit = () => {
		const text = textareaRef.current?.plainText ?? "";
		onDecision({ kind: "reject", feedback: text.trim() });
	};

	return (
		<box flexDirection="column" flexShrink={0} paddingLeft={1} paddingRight={1} paddingBottom={1}>
			<box height={1} flexDirection="row">
				<text fg={colors.warning}>△ </text>
				<text fg={colors.secondary}>确认 edit · </text>
				<text fg={colors.textMuted}>{pending.filePath}</text>
			</box>
			<scrollbox
				maxHeight={20}
				minHeight={3}
				focused={false}
				backgroundColor={colors.backgroundInset}
			>
				<diff
					diff={pending.patch}
					filetype={filetype}
					syntaxStyle={syntaxStyle}
					view={width > 120 ? "split" : "unified"}
					showLineNumbers={true}
					width="100%"
					wrapMode="word"
					fg={colors.text}
					addedBg={colors.diffAddedBg}
					removedBg={colors.diffRemovedBg}
					contextBg={colors.diffContextBg}
					addedSignColor={colors.diffAdded}
					removedSignColor={colors.diffRemoved}
					lineNumberFg={colors.diffLineNumber}
					lineNumberBg={colors.diffContextBg}
					addedLineNumberBg={colors.diffAddedLineNumberBg}
					removedLineNumberBg={colors.diffRemovedLineNumberBg}
					flexShrink={0}
				/>
			</scrollbox>
			{phase === "reject-feedback" ? (
				<box
					borderStyle="rounded"
					border={["top", "right", "bottom", "left"]}
					borderColor={colors.error}
					flexDirection="row"
					paddingLeft={2}
					paddingRight={2}
					paddingTop={1}
					paddingBottom={1}
					backgroundColor={colors.backgroundInset}
				>
					<text width={2} fg={colors.error}>
						{"×"}
					</text>
					<textarea
						ref={textareaRef}
						focused={true}
						height={2}
						minHeight={2}
						maxHeight={4}
						flexGrow={1}
						wrapMode="word"
						backgroundColor={colors.backgroundInset}
						textColor={colors.text}
						cursorColor={colors.error}
						placeholderColor={colors.textMuted}
						placeholder="告诉 agent 该怎么改（空提交=通用拒绝）"
						keyBindings={[
							{ name: "return", action: "submit" },
							{ name: "kpenter", action: "submit" },
							{ name: "return", shift: true, action: "newline" },
						]}
						onSubmit={handleFeedbackSubmit}
					/>
				</box>
			) : (
				<box flexDirection="row" paddingLeft={1} paddingTop={1}>
					<box flexDirection="row">
						<text fg={cursor === 0 ? colors.success : colors.textSubtle}>
							{cursor === 0 ? "▶ " : "  "}
						</text>
						<text fg={cursor === 0 ? colors.secondary : colors.text}>Allow once</text>
					</box>
					<text>{"    "}</text>
					<box flexDirection="row">
						<text fg={cursor === 1 ? colors.error : colors.textSubtle}>
							{cursor === 1 ? "▶ " : "  "}
						</text>
						<text fg={cursor === 1 ? colors.secondary : colors.text}>Reject</text>
					</box>
				</box>
			)}
			<box height={1} flexDirection="row" paddingLeft={1}>
				<text fg={colors.textSubtle}>
					{phase === "reject-feedback"
						? "Enter 提交反馈  Esc 返回"
						: "←/→ 选择  Enter 确认  Esc 拒绝"}
				</text>
			</box>
		</box>
	);
}
