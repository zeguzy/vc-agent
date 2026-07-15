import { useEffect, useState } from "react";
import type { TeamSummary } from "../../client/types.js";
import type { Goal, MemberState, TaskState, TeamMdStructure } from "../../teams/types-v2.js";
import { colors, teamStatusColor, teamStatusIcon } from "../utils/theme.js";

export interface TeamDashboardProps {
	members: MemberState[];
	tasks: TaskState[];
	goals: Goal[];
	teamMd: TeamMdStructure;
	teamSummaries: TeamSummary[];
	activeMemberName: string | null;
	isWelcome: boolean;
	currentSessionId: string;
	cursorSection: Section;
	cursorIndex: number;
	onSelectMember: (name: string) => void;
	onSelectTeam: (sessionId: string) => void;
	onClose: () => void;
}

type Section = "goals" | "members" | "tasks" | "teams";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

const GOAL_STATUS_ICON: Record<string, { icon: string; color: string }> = {
	pending: { icon: "○", color: colors.textMuted },
	in_progress: { icon: "●", color: colors.warning },
	completed: { icon: "✓", color: colors.success },
	blocked: { icon: "⊘", color: colors.error },
	cancelled: { icon: "✗", color: colors.textMuted },
};

function SectionLabel({ label }: { label: string }) {
	return (
		<box flexDirection="row" paddingTop={1}>
			<text fg={colors.secondary}>{label}</text>
		</box>
	);
}

export function TeamDashboard({
	members,
	tasks,
	goals,
	teamMd,
	teamSummaries,
	activeMemberName,
	isWelcome,
	currentSessionId,
	cursorSection,
	cursorIndex,
	onSelectMember,
	onSelectTeam,
	onClose,
}: TeamDashboardProps) {
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

	const otherTeams = isWelcome ? teamSummaries.filter((s) => s.sessionId !== currentSessionId) : [];

	const sections: Array<{ key: Section; items: number }> = [];
	if (goals.length > 0) sections.push({ key: "goals", items: goals.length });
	if (members.length > 0) sections.push({ key: "members", items: members.length });
	if (tasks.length > 0) sections.push({ key: "tasks", items: tasks.length });
	if (otherTeams.length > 0) sections.push({ key: "teams", items: otherTeams.length });

	const currentSection = sections.find((s) => s.key === cursorSection);
	const maxIndex = currentSection ? currentSection.items - 1 : 0;
	const safeCursorIndex = Math.min(cursorIndex, Math.max(0, maxIndex));

	if (members.length === 0 && goals.length === 0 && tasks.length === 0) {
		return (
			<box flexDirection="column" paddingTop={2} paddingLeft={2} flexShrink={0}>
				<text fg={colors.primary}>openagent · team mode</text>
				<text fg={colors.textMuted}>Loading team data...</text>
			</box>
		);
	}

	return (
		<box flexDirection="column" paddingTop={2} paddingLeft={2} paddingRight={2} flexShrink={0}>
			<text fg={colors.primary}>★ openagent · team mode</text>
			{teamMd.mission && <text fg={colors.textSubtle}>Mission: {teamMd.mission}</text>}

			{goals.length > 0 && (
				<box flexDirection="column">
					<SectionLabel label="Goals" />
					{goals.map((g, i) => {
						const si = GOAL_STATUS_ICON[g.status] ?? GOAL_STATUS_ICON.pending;
						const isCursor = cursorSection === "goals" && i === safeCursorIndex;
						return (
							<box
								key={g.id}
								flexDirection="row"
								backgroundColor={isCursor ? colors.backgroundInset : undefined}
							>
								<text fg={si.color}>{si.icon} </text>
								<text fg={isCursor ? colors.primary : colors.text}>
									{g.id}: {g.title}{" "}
								</text>
								<text fg={colors.textMuted}>[{g.status}] </text>
								<text fg={colors.textSubtle}>{g.priority}</text>
							</box>
						);
					})}
				</box>
			)}

			{members.length > 0 && (
				<box flexDirection="column">
					<SectionLabel label="Members" />
					{members.map((m, i) => {
						const isBusy = m.status === "active";
						const iconChar = isBusy
							? SPINNER_FRAMES[spinnerFrame % SPINNER_FRAMES.length]
							: teamStatusIcon(m.status);
						const iconColor = teamStatusColor(m.status);
						const task = m.currentTaskId ? tasks.find((t) => t.id === m.currentTaskId) : null;
						const taskSeg = task ? ` · ${task.id}: ${task.title}` : " —";
						const isCursor = cursorSection === "members" && i === safeCursorIndex;
						const nameColor =
							m.name === activeMemberName || isCursor ? colors.primary : colors.textMuted;
						return (
							<box
								key={m.name}
								flexDirection="row"
								backgroundColor={isCursor ? colors.backgroundInset : undefined}
							>
								<text fg={iconColor}>{iconChar} </text>
								<text fg={nameColor}>
									{m.name}/{m.role || "member"}
								</text>
								<text fg={colors.textMuted}>{taskSeg}</text>
							</box>
						);
					})}
				</box>
			)}

			{tasks.length > 0 && (
				<box flexDirection="column">
					<SectionLabel label="Tasks" />
					{tasks.map((t, i) => {
						const isCursor = cursorSection === "tasks" && i === safeCursorIndex;
						const assignee = t.memberName ?? "unassigned";
						const textColor = t.done ? colors.textMuted : isCursor ? colors.primary : colors.text;
						return (
							<box
								key={t.id}
								flexDirection="row"
								backgroundColor={isCursor ? colors.backgroundInset : undefined}
							>
								<text fg={textColor}>
									{t.id}: {t.title} → {assignee}{" "}
								</text>
								<text fg={colors.textSubtle}>[{t.type}]</text>
							</box>
						);
					})}
				</box>
			)}

			{otherTeams.length > 0 && (
				<box flexDirection="column">
					<SectionLabel label="Other Teams" />
					{otherTeams.map((s, i) => {
						const isCursor = cursorSection === "teams" && i === safeCursorIndex;
						const label = s.sessionName || s.sessionId.slice(0, 8);
						return (
							<box
								key={s.sessionId}
								flexDirection="row"
								backgroundColor={isCursor ? colors.backgroundInset : undefined}
							>
								<text fg={isCursor ? colors.primary : colors.text}>{label} </text>
								<text fg={colors.textMuted}>
									{s.memberCount} members, {s.activeCount} active
								</text>
							</box>
						);
					})}
				</box>
			)}

			<box paddingTop={2}>
				<box border={["top"]} borderColor={colors.borderSoft} />
			</box>
			<box flexDirection="row">
				<text fg={colors.secondary}>j/k=nav Tab=section Enter=select \=close </text>
				<text fg={colors.secondary}>/help /model /sessions /settings Ctrl+C=exit</text>
			</box>
		</box>
	);
}
