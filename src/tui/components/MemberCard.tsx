import type { MemberState, TaskState } from "../../teams/types-v2.js";
import { colors } from "../utils/theme.js";
import { statusIcon } from "./MemberTags.js";

interface MemberCardProps {
	member: MemberState;
	tasks: TaskState[];
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

export function MemberCard({ member, tasks }: MemberCardProps) {
	const memberTasks = tasks.filter((t) => t.memberName === member.name);
	const activeTask = memberTasks.find((t) => !t.done);
	const lastDone = [...memberTasks.filter((t) => t.done)].pop();
	const ctx = member.session.getContextUsage();
	const tokenDisplay =
		ctx?.tokens != null && ctx?.contextWindow != null
			? `${(ctx.tokens / 1000).toFixed(1)}K/${(ctx.contextWindow / 1000).toFixed(0)}K`
			: null;
	const contextPercent = ctx?.percent;
	const ctxColor =
		contextPercent != null && contextPercent > 80 ? colors.warning : colors.textSubtle;

	const truncate = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

	return (
		<box flexDirection="column" flexShrink={0}>
			<box
				borderStyle="single"
				border={["top"]}
				borderColor={colors.borderDim}
				backgroundColor={colors.backgroundInset}
				flexDirection="column"
				paddingLeft={2}
				paddingRight={2}
				paddingTop={1}
				paddingBottom={1}
			>
				<box flexDirection="row">
					<text fg={statusColor(member.status)}>{statusIcon(member.status)} </text>
					<text fg={colors.secondary}>{member.name}</text>
					<text fg={colors.textSubtle}> · </text>
					<text fg={colors.textMuted}>{member.role}</text>
					{member.model && (
						<>
							<text fg={colors.textSubtle}> · </text>
							<text fg={colors.textSubtle}>{member.model}</text>
						</>
					)}
					{tokenDisplay && (
						<>
							<text fg={colors.textSubtle}> · </text>
							<text fg={ctxColor}>ctx {tokenDisplay}</text>
						</>
					)}
				</box>
				{activeTask ? (
					<box flexDirection="row">
						<text fg={colors.textSubtle}>▸ </text>
						<text fg={colors.warning}>{truncate(activeTask.title, 80)}</text>
					</box>
				) : lastDone ? (
					<box flexDirection="row">
						<text fg={colors.textSubtle}>✓ </text>
						<text fg={colors.textSubtle}>{truncate(lastDone.title, 80)}</text>
					</box>
				) : null}
			</box>
		</box>
	);
}
