import { useKeyboard } from "@opentui/react";
import { useState } from "react";
import type { McpManager, McpServerStatus } from "../../mcp/manager.js";
import { colors } from "../theme.js";

interface McpPanelProps {
	mcpManager: McpManager;
	onClose: () => void;
}

export function McpPanel({ mcpManager, onClose }: McpPanelProps) {
	const [statuses, setStatuses] = useState<McpServerStatus[]>(() => mcpManager.getAllStatus());
	const [selectedIdx, setSelectedIdx] = useState(0);
	const [busy, setBusy] = useState(false);

	useKeyboard((key) => {
		if (key.name === "escape") {
			onClose();
			return;
		}
		if (busy) return;
		if (key.name === "j" || key.name === "down") {
			setSelectedIdx((i) => Math.min(statuses.length - 1, i + 1));
		} else if (key.name === "k" || key.name === "up") {
			setSelectedIdx((i) => Math.max(0, i - 1));
		} else if (key.name === "r") {
			const target = statuses[selectedIdx];
			if (target && (target.status === "error" || target.status === "disconnected")) {
				setBusy(true);
				mcpManager
					.reconnect(target.name)
					.then(() => {
						setStatuses(mcpManager.getAllStatus());
						setBusy(false);
					})
					.catch(() => setBusy(false));
			}
		}
	});

	return (
		<box flexShrink={0} paddingLeft={1} paddingRight={1} paddingBottom={1}>
			<box
				borderStyle="rounded"
				border={["top", "right", "bottom", "left"]}
				borderColor={colors.borderActive}
				backgroundColor={colors.backgroundInset}
				flexDirection="column"
				paddingLeft={1}
				paddingRight={1}
			>
				<box flexDirection="row">
					<text fg={colors.primary}>MCP Servers</text>
					<text fg={colors.textMuted}> j/k navigate · r reconnect · Esc close</text>
				</box>
				{statuses.length === 0 ? (
					<text fg={colors.textMuted}>
						No MCP servers configured. Add servers to .openagent/mcp.json
					</text>
				) : (
					statuses.map((s, i) => {
						const isSelected = i === selectedIdx;
						const statusColor =
							s.status === "connected"
								? colors.secondary
								: s.status === "error"
									? colors.warning
									: colors.textMuted;
						return (
							<box key={s.name} flexDirection="column">
								<box flexDirection="row">
									<text fg={isSelected ? colors.secondary : colors.textSubtle}>
										{isSelected ? "▶ " : "  "}
									</text>
									<text fg={colors.text}>{s.name}</text>
									<text fg={colors.textMuted}> [{s.transport}]</text>
									<text fg={statusColor}> {s.status}</text>
									<text fg={colors.textMuted}> · {s.toolCount} tools</text>
								</box>
								{s.error && <text fg={colors.warning}> ⚠ {s.error}</text>}
							</box>
						);
					})
				)}
				{busy && <text fg={colors.textMuted}>reconnecting…</text>}
			</box>
		</box>
	);
}
