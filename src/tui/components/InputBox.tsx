import { useState, useCallback } from "react"
import { colors, icons } from "../theme.js"

interface InputBoxProps {
	disabled: boolean
	onSubmit: (text: string) => void
}

export function InputBox({ disabled, onSubmit }: InputBoxProps) {
	const [value, setValue] = useState("")
	const [, setHistory] = useState<string[]>([])
	const [, setHistoryIndex] = useState(-1)

	const handleSubmit = useCallback(
		(submitted: string) => {
			const trimmed = submitted.trim()
			if (!trimmed || disabled) return
			setHistory((prev) => [...prev, trimmed])
			setHistoryIndex(-1)
			setValue("")
			onSubmit(trimmed)
		},
		[disabled, onSubmit],
	)

	const handleInput = useCallback(
		(newValue: string) => {
			if (disabled) return
			setValue(newValue)
		},
		[disabled],
	)

	return (
		<box height={1} flexDirection="row" paddingLeft={1}>
			<text fg={disabled ? colors.textMuted : colors.primary}>
				{icons.user}{" "}
			</text>
			<input
				value={value}
				focused={!disabled}
				placeholder={disabled ? "Agent 正在响应..." : "输入消息..."}
				onInput={handleInput}
				onSubmit={(value) => handleSubmit(typeof value === "string" ? value : "")}
			/>
		</box>
	)
}
