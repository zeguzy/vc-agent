import { useEffect, useState } from "react";
import type { MemberState, TaskState } from "../../teams/types-v2.js";
import { colors, teamStatusColor, teamStatusIcon } from "../utils/theme.js";

export interface BtwBgTaskRow {
	status: "active" | "done" | "error";
	taskSummary: string;
}

export interface TeamTopologyProps {
	members: MemberState[];
	tasks: TaskState[];
	activeMemberName: string | null;
	btwBackgroundTask?: BtwBgTaskRow | null;
}

const PADDING_LEFT = 2;
const PADDING_RIGHT = 2;
const TREE_INDENT = 4;
const FALLBACK_COLS = 80;
const LEADER_PREFIX_ACTIVE = "▶ ★ ";
const LEADER_PREFIX_IDLE = "  ★ ";
const MEMBER_PREFIX_LEN = 5;
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const MAX_LIST_HEIGHT = 8;

export function effectiveColumns(raw: number | undefined | null): number {
	return raw && raw > 0 ? raw : FALLBACK_COLS;
}

export function computeMaxWidth(columns: number | undefined | null): number {
	return effectiveColumns(columns) - PADDING_LEFT - PADDING_RIGHT - TREE_INDENT;
}

export function truncateToWidth(text: string, maxWidth: number): string {
	if (maxWidth <= 0) return "";
	const chars = [...text];
	if (chars.length <= maxWidth) return text;
	if (maxWidth === 1) return "…";
	return `${chars.slice(0, maxWidth - 1).join("")}…`;
}

export function TeamTopology({
	members,
	tasks,
	activeMemberName,
	btwBackgroundTask,
}: TeamTopologyProps) {
	const [resizeCounter, setResizeCounter] = useState(0);
	const [spinnerFrame, setSpinnerFrame] = useState(0);

	useEffect(() => {
		const handler = () => setResizeCounter((c) => c + 1);
		process.stdout.on("resize", handler);
		return () => {
			process.stdout.off("resize", handler);
		};
	}, []);

	const hasBusy =
		members.some((m) => m.status === "active") || btwBackgroundTask?.status === "active";
	useEffect(() => {
		if (!hasBusy) {
			setSpinnerFrame(0);
			return;
		}
		const interval = setInterval(() => setSpinnerFrame((f) => f + 1), 120);
		return () => clearInterval(interval);
	}, [hasBusy]);

	if (members.length === 0 && !btwBackgroundTask) return null;
	void resizeCounter;

	const maxWidth = computeMaxWidth(process.stdout.columns);

	const leaderActive = activeMemberName === null;
	const leaderPrefix = leaderActive ? LEADER_PREFIX_ACTIVE : LEADER_PREFIX_IDLE;
	const leaderColor = leaderActive ? colors.primary : colors.textMuted;

	const memberRows = members.map((m, idx) => {
		const isLast = idx === members.length - 1;
		const connector = isLast ? "└─ " : "├─ ";
		const isActive = m.name === activeMemberName;
		const activeMarker = isActive ? "▶ " : "  ";
		const prefix = `${connector}${activeMarker}`;

		const isBusy = m.status === "active";
		const iconChar = isBusy
			? SPINNER_FRAMES[spinnerFrame % SPINNER_FRAMES.length]
			: teamStatusIcon(m.status);
		const icon = `${iconChar} `;
		const iconColor = teamStatusColor(m.status);

		const roleSeg = m.role ? `/${m.role}` : "";
		const task = m.currentTaskId ? tasks.find((t) => t.id === m.currentTaskId) : null;
		const taskSeg = task ? ` · ${task.id}: ${task.title}` : "";

		const ctx = m.session.getContextUsage();
		const tokenDisplay =
			ctx?.tokens != null && ctx?.contextWindow != null
				? `${(ctx.tokens / 1000).toFixed(1)}K/${(ctx.contextWindow / 1000).toFixed(0)}K`
				: null;
		const ctxColor = ctx?.percent != null && ctx.percent > 80 ? colors.warning : colors.textSubtle;
		const modelSeg = m.model ? ` · ${m.model}` : "";
		const ctxSeg = tokenDisplay ? ` · ctx ${tokenDisplay}` : "";

		const restMaxWidth = Math.max(0, maxWidth - MEMBER_PREFIX_LEN - 2);
		const rest = truncateToWidth(`${m.name}${roleSeg}${taskSeg}${modelSeg}`, restMaxWidth);

		return {
			key: m.name,
			prefix,
			icon,
			iconColor,
			rest,
			restColor: isActive ? colors.primary : colors.textMuted,
			ctxSeg,
			ctxColor,
		};
	});

	const listHeight = Math.min(members.length + 1 + (btwBackgroundTask ? 1 : 0), MAX_LIST_HEIGHT);

	const bgIcon = btwBackgroundTask
		? btwBackgroundTask.status === "active"
			? `${SPINNER_FRAMES[spinnerFrame % SPINNER_FRAMES.length]} `
			: btwBackgroundTask.status === "done"
				? "✓ "
				: "✗ "
		: "";
	const bgIconColor =
		btwBackgroundTask?.status === "active"
			? colors.warning
			: btwBackgroundTask?.status === "done"
				? colors.success
				: colors.error;
	const bgRestMaxWidth = Math.max(0, maxWidth - MEMBER_PREFIX_LEN - 2);
	const bgRest = btwBackgroundTask
		? truncateToWidth(`bg-task · ${btwBackgroundTask.taskSummary}`, bgRestMaxWidth)
		: "";

	return (
		<box flexShrink={0} paddingLeft={PADDING_LEFT} paddingRight={PADDING_RIGHT}>
			<scrollbox height={listHeight} maxHeight={MAX_LIST_HEIGHT} scrollY focused={false}>
				<box flexDirection="column">
					{members.length > 0 && (
						<box flexDirection="row" height={1}>
							<text fg={leaderColor}>{leaderPrefix}leader</text>
						</box>
					)}
					{memberRows.map((row) => (
						<box key={row.key} flexDirection="row" height={1}>
							<text fg={colors.textSubtle}>{row.prefix}</text>
							<text fg={row.iconColor}>{row.icon}</text>
							<text fg={row.restColor}>{row.rest}</text>
							{row.ctxSeg && <text fg={row.ctxColor}>{row.ctxSeg}</text>}
						</box>
					))}
					{btwBackgroundTask && (
						<box flexDirection="row" height={1}>
							<text fg={colors.textSubtle}>└─ </text>
							<text fg={bgIconColor}>{bgIcon}</text>
							<text fg={colors.textMuted}>{bgRest}</text>
						</box>
					)}
				</box>
			</scrollbox>
		</box>
	);
}
