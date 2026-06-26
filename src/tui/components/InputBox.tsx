import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { TextareaRenderable, KeyBinding as TextareaKeyBinding } from "@opentui/core"
import { colors, icons } from "../theme.js"

import { type Mode } from "../keymap.js"

interface InputBoxProps {
	disabled: boolean
	mode: Mode
	onSubmit: (text: string) => void
}

export function InputBox({ disabled, mode, onSubmit }: InputBoxProps) {
	const [inputHeight, setInputHeight] = useState(2)
	const [animationFrame, setAnimationFrame] = useState(0)
	const textareaRef = useRef<TextareaRenderable | null>(null)
	const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
	const workingSuffix = ["   ", ".  ", ".. ", "..."]

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
	)

	const handleSubmit = useCallback(
		(submitted: string) => {
			const trimmed = submitted.trim()
			if (!trimmed) return
			onSubmit(trimmed)
		},
		[onSubmit],
	)

	const syncTextareaState = useCallback(() => {
		const nextValue = textareaRef.current?.plainText ?? ""
		const nextHeight = Math.min(6, Math.max(2, nextValue.split("\n").length))
		setInputHeight(nextHeight)
		return nextValue
	}, [])

	const handleContentChange = useCallback(() => {
		syncTextareaState()
		},
		[syncTextareaState],
	)

	const handleTextareaSubmit = useCallback(() => {
		const currentValue = syncTextareaState()
		handleSubmit(currentValue)
		if (textareaRef.current) {
			textareaRef.current.clear()
		}
		setInputHeight(2)
	}, [handleSubmit, syncTextareaState])

	useEffect(() => {
		if (!disabled) {
			setAnimationFrame(0)
			return
		}

		const interval = setInterval(() => {
			setAnimationFrame((frame) => frame + 1)
		}, 120)

		return () => clearInterval(interval)
	}, [disabled])

	return (
		<box
			flexDirection="column"
			flexShrink={0}
		>
			<box height={1} flexDirection="row" paddingLeft={1} paddingRight={1}>
				{disabled && (
					<>
						<text fg={colors.warning}>
							{spinnerFrames[animationFrame % spinnerFrames.length]}{" "}
						</text>
						<text fg={colors.text}>
							{`Working${workingSuffix[animationFrame % workingSuffix.length]}`}
						</text>
					</>
				)}
				<box flexGrow={1} />
				<text fg={colors.textSubtle}>
					{mode === "insert"
						? disabled
							? "Enter to queue · Esc: normal"
							: "Enter to send · Shift+Enter newline · Esc: normal"
						: "i: type · j/k: scroll · t: thinking"}
				</text>
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
					<text width={2} fg={mode === "insert" ? (disabled ? colors.textMuted : colors.primary) : colors.textMuted}>
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
						placeholder={disabled ? "Queue a message…" : mode === "insert" ? "Message openagent…" : "Press i to type"}
						keyBindings={keyBindings}
						onContentChange={handleContentChange}
						onSubmit={handleTextareaSubmit}
					/>
				</box>
			</box>
		</box>
	)
}
