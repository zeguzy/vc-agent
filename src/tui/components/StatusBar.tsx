import { useEffect } from "react";
import type { Mode } from "../keymap.js";
import { colors } from "../utils/theme.js";

type ContextDisplay = "compact" | "full";

interface StatusBarProps {
	model: string;
	mode: Mode;
	contextPercent: number | null;
	contextTokens: number | null;
	contextWindow: number | null;
	contextDisplay: ContextDisplay;
	copyFeedback: { ts: number } | null;
	onCopyFeedbackClear?: () => void;
}

const COPY_FEEDBACK_MS = 2000;

export function StatusBar({
	model,
	mode,
	contextPercent,
	contextTokens,
	contextWindow,
	contextDisplay,
	copyFeedback,
	onCopyFeedbackClear,
}: StatusBarProps) {
	const modeColor = mode === "insert" ? colors.success : colors.primary;

	useEffect(() => {
		if (!copyFeedback || !onCopyFeedbackClear) return;
		const elapsed = Date.now() - copyFeedback.ts;
		const remaining = Math.max(0, COPY_FEEDBACK_MS - elapsed);
		const timer = setTimeout(onCopyFeedbackClear, remaining);
		return () => clearTimeout(timer);
	}, [copyFeedback, onCopyFeedbackClear]);

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
	const showCopy = copyFeedback !== null && Date.now() - copyFeedback.ts < COPY_FEEDBACK_MS;

	return (
		<box height={1} flexDirection="row" backgroundColor={colors.backgroundStatus}>
			<text fg={modeColor}>-- {mode.toUpperCase()} --</text>
			<text fg={colors.textSubtle}> </text>
			<text fg={colors.secondary}>{model}</text>
			<box flexGrow={1} />
			{showCopy && <text fg={colors.success}>Copied to clipboard</text>}
			{!showCopy && hasContext && contextDisplay === "compact" && (
				<text fg={ctxColor}>
					◌ {contextPercent !== null ? `${contextPercent.toFixed(0)}%` : "?"}
				</text>
			)}
			{!showCopy &&
				hasContext &&
				contextDisplay === "full" &&
				contextTokens !== null &&
				contextWindow !== null && (
					<>
						<text fg={ctxColor}>
							◌ {fmtTokens(contextTokens)}/{fmtTokens(contextWindow)}
						</text>
						{contextPercent !== null && <text fg={ctxColor}> ({contextPercent.toFixed(0)}%)</text>}
					</>
				)}
		</box>
	);
}
