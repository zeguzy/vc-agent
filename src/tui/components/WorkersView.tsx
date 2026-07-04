import { useKeyboard } from "@opentui/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentClient } from "../../client/index.js";
import type { WorkerSnapshot } from "../../teams/types.js";
import { colors } from "../utils/theme.js";

interface WorkersViewProps {
	client: AgentClient;
	onClose: () => void;
}

function statusIcon(status: WorkerSnapshot["status"]): string {
	switch (status) {
		case "running":
			return "◌";
		case "idle":
			return "○";
		case "done":
			return "✓";
		case "error":
			return "✗";
		case "cancelled":
			return "⊘";
	}
}

function statusColor(status: WorkerSnapshot["status"]): string {
	switch (status) {
		case "running":
			return colors.warning;
		case "idle":
			return colors.textMuted;
		case "done":
			return colors.success;
		case "error":
			return colors.error;
		case "cancelled":
			return colors.textMuted;
	}
}

function summaryPreview(s: WorkerSnapshot): string {
	if (s.lastSummary) {
		const line = s.lastSummary.split("\n")[0];
		return line.length > 60 ? `${line.slice(0, 57)}…` : line;
	}
	if (s.lastError) return `error: ${s.lastError.slice(0, 50)}`;
	return "";
}

export function WorkersView({ client, onClose }: WorkersViewProps) {
	const [snapshots, setSnapshots] = useState<WorkerSnapshot[]>(() => client.listWorkers());
	const [selectedIdx, setSelectedIdx] = useState(0);
	const [focusedId, setFocusedId] = useState<string | null>(null);

	const snapshotsRef = useRef(snapshots);
	snapshotsRef.current = snapshots;
	const selectedIdxRef = useRef(selectedIdx);
	selectedIdxRef.current = selectedIdx;
	const onCloseRef = useRef(onClose);
	onCloseRef.current = onClose;

	const focusedWorker = useMemo(
		() => snapshots.find((s) => s.id === focusedId) ?? null,
		[snapshots, focusedId],
	);

	useEffect(() => {
		const unsub = client.subscribeTeam(() => {
			setSnapshots(client.listWorkers());
		});
		const interval = setInterval(() => {
			setSnapshots(client.listWorkers());
		}, 500);
		return () => {
			unsub();
			clearInterval(interval);
		};
	}, [client]);

	useKeyboard((key) => {
		const list = snapshotsRef.current;
		const idx = selectedIdxRef.current;

		if (focusedId) {
			if (key.name === "escape") {
				setFocusedId(null);
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
			if (target) setFocusedId(target.id);
		} else if (key.name === "escape") {
			onCloseRef.current();
		}
	});

	if (focusedWorker) {
		const summary = focusedWorker.lastSummary ?? "(no output)";
		const error = focusedWorker.lastError;
		const costStr = focusedWorker.cost > 0 ? ` $${focusedWorker.cost.toFixed(4)}` : "";
		const sc = statusColor(focusedWorker.status);
		const si = statusIcon(focusedWorker.status);

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
					<text fg={colors.textMuted}>{focusedWorker.id}</text>
					<text fg={colors.textSubtle}>/{focusedWorker.agent} </text>
					<text fg={sc}>{focusedWorker.status}</text>
					<text fg={colors.textMuted}>{costStr}</text>
				</box>
				<box flexDirection="row" flexShrink={0} marginTop={1}>
					<text fg={colors.textSubtle}>
						turns={focusedWorker.turnCount} in={focusedWorker.inputTokens} out=
						{focusedWorker.outputTokens}
					</text>
				</box>
				{error && (
					<box flexShrink={0} marginTop={1}>
						<text fg={colors.error}>error: {error}</text>
					</box>
				)}
				<scrollbox flexGrow={1} scrollY marginTop={1}>
					<box flexDirection="column">
						<text fg={colors.text}>{summary}</text>
					</box>
				</scrollbox>
			</box>
		);
	}

	if (snapshots.length === 0) {
		return (
			<box flexShrink={0} paddingLeft={2} paddingTop={1} paddingBottom={1} flexDirection="row">
				<text fg={colors.textMuted}>
					No active workers. Workers appear here when spawned via team.spawn().
				</text>
			</box>
		);
	}

	const cur = Math.min(selectedIdx, Math.max(0, snapshots.length - 1));

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
					<text fg={colors.primary}>Workers ({snapshots.length})</text>
					<text fg={colors.textMuted}> ↑↓ navigate · Enter focus · Esc close</text>
				</box>
				<scrollbox flexGrow={0} maxHeight={12} scrollY>
					{snapshots.map((s, i) => {
						const isSelected = i === cur;
						const sc = statusColor(s.status);
						const si = statusIcon(s.status);
						const preview = summaryPreview(s);
						const costStr = s.cost > 0 ? ` $${s.cost.toFixed(4)}` : "";

						return (
							<box
								key={s.id}
								flexDirection="row"
								backgroundColor={isSelected ? colors.backgroundMenu : undefined}
							>
								<text fg={isSelected ? colors.secondary : colors.textSubtle}>
									{isSelected ? "▶ " : "  "}
								</text>
								<text fg={sc}>{si} </text>
								<text fg={isSelected ? colors.primary : colors.textMuted}>{s.id.slice(0, 10)}</text>
								<text fg={isSelected ? colors.text : colors.textSubtle}>
									{" "}
									· {s.agent} · {s.status}
								</text>
								<text fg={colors.textMuted}>{costStr}</text>
								{preview && (
									<>
										<text fg={colors.textSubtle}> — </text>
										<text fg={colors.textSubtle}>{preview}</text>
									</>
								)}
							</box>
						);
					})}
				</scrollbox>
			</box>
		</box>
	);
}
