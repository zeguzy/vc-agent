import { useEffect, useState } from "react";
import type { MemberState } from "../../teams/types-v2.js";
import { colors, teamStatusIcon } from "../utils/theme.js";

export interface TeamStatusBarProps {
	members: MemberState[];
	activeMemberName: string | null;
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const PADDING = 4;

export function TeamStatusBar({ members, activeMemberName }: TeamStatusBarProps) {
	const [spinnerFrame, setSpinnerFrame] = useState(0);

	const hasBusy = members.some((m) => m.status === "active");
	useEffect(() => {
		if (!hasBusy) {
			setSpinnerFrame(0);
			return;
		}
		const interval = setInterval(() => setSpinnerFrame((f) => f + 1), 120);
		return () => clearInterval(interval);
	}, [hasBusy]);

	if (members.length === 0) return null;

	const columns = process.stdout.columns || 80;
	const maxWidth = columns - PADDING;

	const leaderActive = activeMemberName === null;
	const leaderColor = leaderActive ? colors.primary : colors.textMuted;

	const segments: Array<{ text: string; color: string }> = [
		{ text: "★ leader", color: leaderColor },
	];

	for (const m of members) {
		const isBusy = m.status === "active";
		const iconChar = isBusy
			? SPINNER_FRAMES[spinnerFrame % SPINNER_FRAMES.length]
			: teamStatusIcon(m.status);
		const taskSeg = m.currentTaskId ? `·${m.currentTaskId}` : "";
		const text = `${iconChar}${m.name}${taskSeg}`;
		const color = m.name === activeMemberName ? colors.primary : colors.textMuted;
		segments.push({ text, color });
	}

	const parts: Array<{ text: string; color: string }> = [];
	let totalLen = 0;
	for (let i = 0; i < segments.length; i++) {
		const prefix = i === 0 ? "" : " | ";
		const segLen = prefix.length + [...segments[i].text].length;
		if (totalLen + segLen > maxWidth) {
			parts.push({ text: "…", color: colors.textMuted });
			break;
		}
		if (prefix) {
			parts.push({ text: prefix, color: colors.textSubtle });
		}
		parts.push(segments[i]);
		totalLen += segLen;
	}

	return (
		<box flexDirection="row" paddingLeft={2} paddingRight={2} flexShrink={0}>
			{parts.map((p, i) => (
				<text key={i} fg={p.color}>
					{p.text}
				</text>
			))}
		</box>
	);
}
