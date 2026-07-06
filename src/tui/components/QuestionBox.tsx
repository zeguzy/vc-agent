import type { KeyEvent, TextareaRenderable } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useCallback, useRef, useState } from "react";
import type { QuestionData } from "../../tools/question-bridge.js";
import { colors } from "../utils/theme.js";

interface QuestionBoxProps {
	questionData: QuestionData;
	onSubmit: (answers: string[][]) => void;
	onCancel: () => void;
}

const CUSTOM_OPTION_LABEL = "Type something…";

export function QuestionBox({ questionData, onSubmit, onCancel }: QuestionBoxProps) {
	const total = questionData.questions.length;
	const [currentIdx, setCurrentIdx] = useState(0);
	const [cursor, setCursor] = useState(0);
	const [multiSelected, setMultiSelected] = useState<Set<number>[]>(() =>
		questionData.questions.map(() => new Set()),
	);
	const [customTexts, setCustomTexts] = useState<string[]>(() =>
		questionData.questions.map(() => ""),
	);
	const [inCustomMode, setInCustomMode] = useState(false);
	const textareaRef = useRef<TextareaRenderable | null>(null);

	const currentQ = questionData.questions[currentIdx];
	const optionCount = currentQ.options.length;
	const isLast = currentIdx === total - 1;
	const isMulti = currentQ.multiple === true;

	// Patch reflects an in-flight setState that React hasn't flushed yet — without it,
	// onSubmit() would observe stale state and report the just-selected answer as "Unanswered".
	const buildAnswers = useCallback(
		(
			patchIdx: number,
			patchSelected: Set<number> | null,
			patchCustom: string | null,
		): string[][] => {
			return questionData.questions.map((q, i) => {
				const selected = patchIdx === i && patchSelected ? patchSelected : multiSelected[i];
				const custom = patchIdx === i && patchCustom !== null ? patchCustom : customTexts[i];
				const labels = [...selected].sort((a, b) => a - b).map((idx) => q.options[idx].label);
				const trimmed = custom.trim();
				if (trimmed) labels.push(trimmed);
				return labels;
			});
		},
		[multiSelected, customTexts, questionData.questions],
	);

	const advanceWith = useCallback(
		(answers: string[][]) => {
			if (isLast) {
				onSubmit(answers);
			} else {
				setCurrentIdx((i) => i + 1);
				setCursor(0);
			}
		},
		[isLast, onSubmit],
	);

	const advance = useCallback(() => {
		advanceWith(buildAnswers(-1, null, null));
	}, [advanceWith, buildAnswers]);

	const handleConfirm = useCallback(() => {
		if (cursor === optionCount) {
			setInCustomMode(true);
			return;
		}
		if (isMulti) {
			advance();
			return;
		}
		const nextSelected = new Set<number>([cursor]);
		setMultiSelected((prev) => {
			const copy = [...prev];
			copy[currentIdx] = nextSelected;
			return copy;
		});
		advanceWith(buildAnswers(currentIdx, nextSelected, customTexts[currentIdx]));
	}, [cursor, optionCount, isMulti, advance, advanceWith, buildAnswers, currentIdx, customTexts]);

	useKeyboard((key: KeyEvent) => {
		if (inCustomMode) {
			if (key.name === "escape") {
				setInCustomMode(false);
			}
			return;
		}

		switch (key.name) {
			case "up":
				setCursor((c) => Math.max(0, c - 1));
				break;
			case "down":
				setCursor((c) => Math.min(optionCount, c + 1));
				break;
			case "space":
				if (isMulti && cursor < optionCount) {
					setMultiSelected((prev) => {
						const copy = [...prev];
						const set = new Set(copy[currentIdx]);
						if (set.has(cursor)) set.delete(cursor);
						else set.add(cursor);
						copy[currentIdx] = set;
						return copy;
					});
				}
				break;
			case "return":
			case "kpenter":
				handleConfirm();
				break;
			case "tab":
				if (!isLast) advance();
				break;
			case "escape":
				onCancel();
				break;
		}
	});

	const handleCustomSubmit = useCallback(() => {
		const text = textareaRef.current?.plainText ?? "";
		const nextSelected = isMulti ? multiSelected[currentIdx] : new Set<number>();
		setCustomTexts((prev) => {
			const copy = [...prev];
			copy[currentIdx] = text;
			return copy;
		});
		if (!isMulti) {
			setMultiSelected((prev) => {
				const copy = [...prev];
				copy[currentIdx] = nextSelected;
				return copy;
			});
		}
		setInCustomMode(false);
		advanceWith(buildAnswers(currentIdx, nextSelected, text));
	}, [currentIdx, isMulti, multiSelected, advanceWith, buildAnswers]);

	return (
		<box flexDirection="column" flexShrink={0} paddingLeft={1} paddingRight={1}>
			<box height={1} flexDirection="row">
				<text fg={colors.primary}>❓ </text>
				<text fg={colors.secondary}>
					Question {currentIdx + 1}/{total}{" "}
				</text>
				<text fg={colors.textMuted}>— {currentQ.header}</text>
			</box>
			<box flexDirection="column" paddingLeft={1} paddingRight={1}>
				<text fg={colors.text}>{currentQ.question}</text>
				{isMulti && <text fg={colors.textSubtle}> (multi-select with Space)</text>}
			</box>
			{inCustomMode ? (
				<box
					borderStyle="rounded"
					border={["top", "right", "bottom", "left"]}
					borderColor={colors.borderActive}
					flexDirection="row"
					paddingLeft={2}
					paddingRight={2}
					paddingTop={1}
					paddingBottom={1}
					backgroundColor={colors.backgroundInset}
				>
					<text width={2} fg={colors.primary}>
						{">"}
					</text>
					<textarea
						ref={textareaRef}
						initialValue={customTexts[currentIdx] || ""}
						focused={true}
						height={2}
						minHeight={2}
						maxHeight={4}
						flexGrow={1}
						wrapMode="word"
						backgroundColor={colors.backgroundInset}
						focusedBackgroundColor={colors.backgroundInset}
						textColor={colors.text}
						focusedTextColor={colors.text}
						cursorColor={colors.primary}
						placeholderColor={colors.textMuted}
						placeholder="Type your answer…"
						keyBindings={[
							{ name: "return", action: "submit" },
							{ name: "kpenter", action: "submit" },
							{ name: "return", shift: true, action: "newline" },
						]}
						onSubmit={handleCustomSubmit}
					/>
				</box>
			) : (
				<box flexDirection="column" paddingLeft={1}>
					{currentQ.options.map((opt, i) => {
						const isSelected = cursor === i;
						const isMultiChecked = isMulti && multiSelected[currentIdx].has(i);
						return (
							<box key={opt.label} flexDirection="row">
								<text fg={isSelected ? colors.primary : colors.textSubtle}>
									{isSelected ? "▶ " : "  "}
								</text>
								<text fg={isMultiChecked ? colors.success : colors.textSubtle}>
									{isMulti ? (isMultiChecked ? "☑ " : "☐ ") : ""}
								</text>
								<text fg={isSelected ? colors.secondary : colors.text}>{opt.label}</text>
								<text fg={colors.textMuted}> {opt.description}</text>
							</box>
						);
					})}
					<box flexDirection="row">
						<text fg={cursor === optionCount ? colors.primary : colors.textSubtle}>
							{cursor === optionCount ? "▶ " : "  "}
						</text>
						<text fg={cursor === optionCount ? colors.secondary : colors.textMuted}>
							{CUSTOM_OPTION_LABEL}
						</text>
					</box>
				</box>
			)}
			<box height={1} flexDirection="row" paddingLeft={1}>
				<text fg={colors.textSubtle}>
					{inCustomMode
						? "Enter Submit  Esc Back"
						: isMulti
							? "Space Toggle  Enter Confirm  Tab Next  Esc Cancel"
							: "↑↓ Navigate  Enter Select  Tab Next  Esc Cancel"}
				</text>
			</box>
		</box>
	);
}
