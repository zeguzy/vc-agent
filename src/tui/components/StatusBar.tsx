import { useEffect } from "react";
import type { Mode } from "../keymap.js";
import { colors } from "../utils/theme.js";

interface StatusBarProps {
	mode: Mode;
	contextPercent: number | null;
	contextTokens: number | null;
	contextWindow: number | null;
	copyFeedback: { ts: number } | null;
	onCopyFeedbackClear?: () => void;
}

const COPY_FEEDBACK_MS = 2000;

export function StatusBar({
	mode,
	contextPercent,
	contextTokens,
	contextWindow,
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

	const hasContext = contextTokens !== null && contextWindow !== null;
	const showCopy = copyFeedback !== null && Date.now() - copyFeedback.ts < COPY_FEEDBACK_MS;

	const fmtTokens = (n: number) => {
		if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
		return String(n);
	};

	return (
		<box marginBottom={1} backgroundColor={colors.backgroundBar}>
			<box height={1} flexDirection="row" paddingLeft={2} paddingRight={2}>
				<text fg={modeColor}>-- {mode.toUpperCase()} --</text>
				<box flexGrow={1} />
				{showCopy && <text fg={colors.success}>Copied to clipboard</text>}
				{!showCopy && hasContext && (
					<text fg={colors.textMuted}>
						{contextTokens !== null ? fmtTokens(contextTokens) : "?"}
						{contextPercent !== null ? ` (${contextPercent.toFixed(0)}%)` : ""}
					</text>
				)}
			</box>
		</box>
	);
}
