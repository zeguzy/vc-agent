import { colors } from "../theme.js"
import type { Mode } from "../keymap.js"

interface StatusBarProps {
	model: string
	cwd: string
	mode: Mode
}

export function StatusBar({ model, cwd, mode }: StatusBarProps) {
	const shortCwd = cwd.split("/").slice(-2).join("/")

	const modeColor =
		mode === "insert" ? colors.success
		: colors.primary

	return (
		<box
			height={1}
			flexDirection="row"
			paddingLeft={1}
			paddingRight={1}
			backgroundColor={colors.backgroundStatus}
		>
			<text fg={modeColor}>-- {mode.toUpperCase()} --</text>
			<text fg={colors.textSubtle}>  </text>
			<text fg={colors.secondary}>{model}</text>
			<text fg={colors.textSubtle}> · </text>
			<text fg={colors.textMuted}>{shortCwd}</text>
		</box>
	)
}
