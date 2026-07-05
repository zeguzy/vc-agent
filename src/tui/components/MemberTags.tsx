import type { MemberState } from "../../teams/types-v2.js";
import { colors } from "../utils/theme.js";

interface MemberTagsProps {
	members: MemberState[];
	activeMemberName: string | null;
	onMemberChange: () => void;
}

export function statusIcon(status: MemberState["status"]): string {
	switch (status) {
		case "active":
			return "◌";
		case "idle":
			return "○";
		case "done":
			return "✓";
		case "error":
			return "✗";
		case "paused":
			return "⏸";
		case "cancelled":
			return "⊘";
	}
}

function statusColor(status: MemberState["status"]): string {
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

export function MemberTags({ members, activeMemberName, onMemberChange }: MemberTagsProps) {
	if (members.length === 0) {
		return null;
	}

	return (
		<box height={1} flexDirection="row" paddingLeft={1} paddingRight={1} flexShrink={0}>
			{/* Leader tag */}
			<text fg={activeMemberName === null ? colors.primary : colors.textSubtle}>
				{activeMemberName === null ? "▶ " : "  "}
			</text>
			<text fg={activeMemberName === null ? colors.primary : colors.textMuted}>leader</text>
			{/* Member tags */}
			{members.map((m) => {
				const sc = statusColor(m.status);
				const si = statusIcon(m.status);
				const isActive = m.name === activeMemberName;
				return (
					<box key={m.name} flexDirection="row">
						<text fg={colors.textMuted}> · </text>
						<text fg={isActive ? colors.primary : colors.textSubtle}>{isActive ? "▶ " : "  "}</text>
						<text fg={isActive ? colors.primary : colors.textMuted}>{m.name} </text>
						<text fg={sc}>({si})</text>
					</box>
				);
			})}
		</box>
	);
}
