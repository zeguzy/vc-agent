import { colors, icons } from "../theme.js"

export function StatusBar({ model, cwd }: { model: string; cwd: string }) {
	const shortCwd = cwd.split("/").slice(-2).join("/")
	return (
		<box height={1} flexDirection="row" paddingLeft={1}>
			<text fg={colors.primary}>{icons.statusDot} </text>
			<text fg={colors.text}>openagent</text>
			<text fg={colors.textMuted}> · </text>
			<text fg={colors.textMuted}>model: </text>
			<text fg={colors.secondary}>{model}</text>
			<text fg={colors.textMuted}> · </text>
			<text fg={colors.textMuted}>cwd: </text>
			<text fg={colors.secondary}>{shortCwd}</text>
		</box>
	)
}
