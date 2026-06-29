import { useEffect, useState } from "react";
import type { TodoItem } from "../../tools/todo.js";
import { colors } from "../utils/theme.js";

interface TodoPanelProps {
	todos: TodoItem[];
	working: boolean;
}

const waveFrames = ["▁▃▅", "▂▄▆", "▃▅▇", "▄▆█", "▃▅▇", "▂▄▆"];

export function TodoPanel({ todos, working }: TodoPanelProps) {
	const [frame, setFrame] = useState(0);
	const hasInProgress = todos.some((t) => t.status === "in_progress");

	useEffect(() => {
		setFrame(0);
		if (!working || !hasInProgress) return;
		const id = setInterval(() => setFrame((f) => f + 1), 120);
		return () => clearInterval(id);
	}, [working, hasInProgress]);

	if (todos.length === 0) return null;
	const completed = todos.filter((t) => t.status === "completed").length;

	return (
		<box flexDirection="column" paddingLeft={1} paddingRight={1} paddingBottom={1} flexShrink={0}>
			<box height={1} flexDirection="row">
				<text fg={colors.secondary}>📋 </text>
				<text fg={colors.primary}>TODO </text>
				<text fg={colors.textMuted}>
					({completed}/{todos.length})
				</text>
			</box>
			{todos.map((t) => {
				const sym = t.status === "completed" ? "✓" : t.status === "in_progress" ? "●" : "○";
				const symColor =
					t.status === "completed"
						? colors.textMuted
						: t.status === "in_progress"
							? colors.primary
							: colors.textSubtle;
				return (
					<box key={t.id} height={1} flexDirection="row">
						<text fg={symColor}>{sym} </text>
						{t.status === "in_progress" && working && (
							<text fg={colors.primary}>{waveFrames[frame % waveFrames.length]} </text>
						)}
						<text fg={t.status === "completed" ? colors.textMuted : colors.text}>{t.content}</text>
					</box>
				);
			})}
		</box>
	);
}
