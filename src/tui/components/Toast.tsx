import type { NotificationPayload } from "../../notifications/types.js";
import { colors } from "../utils/theme.js";

interface ToastProps {
	toast: NotificationPayload | null;
}

export function Toast({ toast }: ToastProps) {
	if (!toast) return null;
	return (
		<box flexShrink={0} paddingLeft={1} paddingRight={1}>
			<box
				borderStyle="rounded"
				border={["top", "right", "bottom", "left"]}
				borderColor={colors.borderActive}
				backgroundColor={colors.backgroundInset}
				paddingLeft={1}
				paddingRight={1}
				flexDirection="row"
			>
				<text fg={colors.secondary}>● </text>
				<text fg={colors.primary}>{toast.title}</text>
				<text fg={colors.textMuted}> · </text>
				<text fg={colors.text}>{toast.message}</text>
			</box>
		</box>
	);
}
