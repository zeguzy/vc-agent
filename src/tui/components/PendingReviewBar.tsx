import { useKeyboard } from "@opentui/react";
import { useCallback, useRef, useState } from "react";
import type { DiffReviewManager } from "../../diff-review/manager.js";
import { colors } from "../utils/theme.js";

interface PendingReviewBarProps {
	manager: DiffReviewManager;
	onOpenReview: () => void;
	onAcceptAll: () => void;
	onRejectAll: () => void;
}

export function PendingReviewBar({
	manager,
	onOpenReview,
	onAcceptAll,
	onRejectAll,
}: PendingReviewBarProps) {
	const pending = manager.getPendingFiles();
	const count = pending.length;
	if (count === 0) return null;

	const fileNames = pending.slice(0, 3).map((f) => {
		const parts = f.filePath.split("/");
		return parts[parts.length - 1] || f.filePath;
	});
	const more = count > 3 ? ` +${count - 3} more` : "";

	const [cursor, setCursor] = useState<null | "accept" | "reject">(null);

	useKeyboard((key) => {
		// Only handle keys when bar is focused (cursor is set)
		if (cursor === null) return;
		if (key.name === "a" || key.name === "A") {
			onAcceptAll();
			setCursor(null);
		} else if (key.name === "r" || key.name === "R") {
			onRejectAll();
			setCursor(null);
		} else if (key.name === "return" || key.name === "kpenter") {
			onOpenReview();
			setCursor(null);
		} else if (key.name === "escape") {
			setCursor(null);
		}
	});

	return (
		<box
			flexShrink={0}
			flexDirection="column"
			paddingLeft={3}
			paddingRight={3}
			paddingTop={0}
			paddingBottom={0}
		>
			<box
				borderStyle="rounded"
				border={["top", "right", "bottom", "left"]}
				borderColor={colors.warning}
				backgroundColor={colors.backgroundInset}
				paddingLeft={1}
				paddingRight={1}
				flexDirection="column"
			>
				<box flexDirection="row">
					<text fg={colors.warning}>△ </text>
					<text fg={colors.secondary}>
						{count} file{count !== 1 ? "s" : ""} pending review:{" "}
					</text>
					<text fg={colors.textMuted}>
						{fileNames.join(", ")}
						{more}
					</text>
				</box>
				<box flexDirection="row" paddingTop={0}>
					<text fg={colors.textSubtle}>Enter=review A=accept all R=reject all</text>
				</box>
			</box>
		</box>
	);
}
