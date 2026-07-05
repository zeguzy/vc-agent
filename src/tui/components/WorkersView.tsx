import { useKeyboard } from "@opentui/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentClient } from "../../client/index.js";
import type { MemberState } from "../../teams/types-v2.js";
import { colors } from "../utils/theme.js";

interface WorkersViewProps {
	client: AgentClient;
	onClose: () => void;
}

function statusIcon(status: MemberState["status"]): string {
	switch (status) {
		case "active":
			return "◌";
		case "idle":
			return "○";
		case "done":
			return "✓";
		case "error":
			return "✗";
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
	}
}

export function WorkersView({ client, onClose }: WorkersViewProps) {
	const [members, setMembers] = useState<MemberState[]>(() => client.listMembers());
	const [selectedIdx, setSelectedIdx] = useState(0);
	const [focusedName, setFocusedName] = useState<string | null>(null);

	const membersRef = useRef(members);
	membersRef.current = members;
	const selectedIdxRef = useRef(selectedIdx);
	selectedIdxRef.current = selectedIdx;
	const onCloseRef = useRef(onClose);
	onCloseRef.current = onClose;

	const focusedMember = useMemo(
		() => members.find((m) => m.name === focusedName) ?? null,
		[members, focusedName],
	);

	useEffect(() => {
		const unsub = client.subscribeTeam(() => {
			setMembers(client.listMembers());
		});
		const interval = setInterval(() => {
			setMembers(client.listMembers());
		}, 500);
		return () => {
			unsub();
			clearInterval(interval);
		};
	}, [client]);

	useKeyboard((key) => {
		const list = membersRef.current;
		const idx = selectedIdxRef.current;

		if (focusedName) {
			if (key.name === "escape") {
				setFocusedName(null);
			}
			return;
		}

		if (key.name === "up" || key.name === "k") {
			setSelectedIdx(Math.max(0, idx - 1));
		} else if (key.name === "down" || key.name === "j") {
			setSelectedIdx(Math.min(list.length - 1, idx + 1));
		} else if (key.name === "g") {
			setSelectedIdx(0);
		} else if (key.name === "G" || (key.shift && key.name === "g")) {
			setSelectedIdx(Math.max(0, list.length - 1));
		} else if (key.name === "return") {
			const target = list[idx];
			if (target) setFocusedName(target.name);
		} else if (key.name === "escape") {
			onCloseRef.current();
		}
	});

	if (focusedMember) {
		const sc = statusColor(focusedMember.status);
		const si = statusIcon(focusedMember.status);

		return (
			<box
				flexGrow={1}
				flexDirection="column"
				backgroundColor={colors.background}
				paddingLeft={2}
				paddingRight={2}
				paddingTop={1}
			>
				<box flexDirection="row" flexShrink={0}>
					<text fg={colors.textMuted}>{"<- ESC back"}</text>
				</box>
				<box flexDirection="row" flexShrink={0} marginTop={1}>
					<text fg={sc}>{si} </text>
					<text fg={colors.primary}>{focusedMember.name}</text>
					<text fg={colors.textSubtle}>/{focusedMember.role} </text>
					<text fg={sc}>{focusedMember.status}</text>
				</box>
				<box flexDirection="row" flexShrink={0} marginTop={1}>
					<text fg={colors.textSubtle}>
						goal: {focusedMember.goal}
					</text>
				</box>
			</box>
		);
	}

	if (members.length === 0) {
		return (
			<box flexShrink={0} paddingLeft={2} paddingTop={1} paddingBottom={1} flexDirection="row">
				<text fg={colors.textMuted}>
					No team members. Create one with team-edit (add-member).
				</text>
			</box>
		);
	}

	const cur = Math.min(selectedIdx, Math.max(0, members.length - 1));

	return (
		<box flexShrink={0} paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1}>
			<box
				borderStyle="rounded"
				border={["top", "right", "bottom", "left"]}
				borderColor={colors.borderActive}
				backgroundColor={colors.backgroundInset}
				flexDirection="column"
				paddingLeft={1}
				paddingRight={1}
			>
				<box flexDirection="row" flexShrink={0}>
					<text fg={colors.primary}>Members ({members.length})</text>
					<text fg={colors.textMuted}> ↑↓ navigate · Enter focus · Esc close</text>
				</box>
				<scrollbox flexGrow={0} maxHeight={12} scrollY>
					{members.map((m, i) => {
						const isSelected = i === cur;
						const sc = statusColor(m.status);
						const si = statusIcon(m.status);
						const taskLabel = m.currentTaskId ? ` · task ${m.currentTaskId}` : "";

						return (
							<box
								key={m.name}
								flexDirection="row"
								backgroundColor={isSelected ? colors.backgroundMenu : undefined}
							>
								<text fg={isSelected ? colors.secondary : colors.textSubtle}>
									{isSelected ? "▶ " : "  "}
								</text>
								<text fg={sc}>{si} </text>
								<text fg={isSelected ? colors.primary : colors.textMuted}>{m.name}</text>
								<text fg={isSelected ? colors.text : colors.textSubtle}>
									{" "}
									· {m.role} · {m.status}{taskLabel}
								</text>
							</box>
						);
					})}
				</scrollbox>
			</box>
		</box>
	);
}
