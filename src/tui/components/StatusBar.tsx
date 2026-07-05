import { useEffect } from "react";
import type { AgentMode } from "../../agent/session.js";
import type { MemberState } from "../../teams/types-v2.js";
import type { Mode } from "../keymap.js";
import { colors } from "../utils/theme.js";
import { statusIcon } from "./MemberTags.js";

interface StatusBarProps {
	mode: Mode;
	agentMode: AgentMode;
	contextPercent: number | null;
	contextTokens: number | null;
	contextWindow: number | null;
	copyFeedback: { ts: number } | null;
	onCopyFeedbackClear?: () => void;
	members: MemberState[];
	activeMemberName: string | null;
}

const COPY_FEEDBACK_MS = 2000;

function memberStatusColor(status: MemberState["status"]): string {
	switch (status) {
		case "active":
			return colors.warning;
		case "idle":
			return colors.textMuted;
		case "done":
			return colors.success;
		case "error":
			return colors.error;
		case "paused":
			return colors.info;
		case "cancelled":
			return colors.textMuted;
	}
}

export function StatusBar({
	mode,
	agentMode,
	contextPercent,
	contextTokens,
	contextWindow,
	copyFeedback,
	onCopyFeedbackClear,
	members,
	activeMemberName,
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

	const showMembers = agentMode === "team" && members.length > 0;

	return (
		<box marginBottom={1} backgroundColor={colors.backgroundBar}>
			<box height={1} flexDirection="row" paddingLeft={2} paddingRight={2}>
				<text fg={modeColor}>-- {mode.toUpperCase()} --</text>
				{showMembers &&
					members.map((m) => (
						<box key={m.name} flexDirection="row">
							<text fg={colors.textSubtle}> · </text>
							<text fg={m.name === activeMemberName ? colors.primary : colors.textMuted}>
								{m.name}
							</text>
							<text fg={memberStatusColor(m.status)}> {statusIcon(m.status)}</text>
						</box>
					))}
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
