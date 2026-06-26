import type { Mode } from "../keymap.js";
import { colors } from "../theme.js";

type ContextDisplay = "compact" | "full";

interface StatusBarProps {
	model: string;
	mode: Mode;
	contextPercent: number | null;
	contextTokens: number | null;
	contextWindow: number | null;
	contextDisplay: ContextDisplay;
}

export function StatusBar({
	model,
	mode,
	contextPercent,
	contextTokens,
	contextWindow,
	contextDisplay,
}: StatusBarProps) {
	const modeColor = mode === "insert" ? colors.success : colors.primary;

	const ctxColor =
		contextPercent === null
			? colors.textMuted
			: contextPercent < 50
				? colors.success
				: contextPercent < 80
					? colors.warning
					: colors.error;

	const fmtTokens = (n: number) => {
		if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
		return String(n);
	};

	const hasContext = contextTokens !== null && contextWindow !== null;

	return (
		<box height={1} flexDirection="row" backgroundColor={colors.backgroundStatus}>
			<text fg={modeColor}>-- {mode.toUpperCase()} --</text>
			<text fg={colors.textSubtle}> </text>
			<text fg={colors.secondary}>{model}</text>
			<box flexGrow={1} />
			{hasContext && contextDisplay === "compact" && (
				<text fg={ctxColor}>
					◌ {contextPercent !== null ? `${contextPercent.toFixed(0)}%` : "?"}
				</text>
			)}
			{hasContext && contextDisplay === "full" && (
				<>
					<text fg={ctxColor}>
						◌ {fmtTokens(contextTokens!)}/{fmtTokens(contextWindow!)}
					</text>
					{contextPercent !== null && <text fg={ctxColor}> ({contextPercent.toFixed(0)}%)</text>}
				</>
			)}
		</box>
	);
}
