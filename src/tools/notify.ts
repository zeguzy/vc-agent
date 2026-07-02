import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { getGlobalRouter } from "../notifications/notifier.js";
import type { NotificationEvent } from "../notifications/types.js";

const NotifyParams = Type.Object({
	message: Type.String({
		description: "Notification body text shown to the user.",
	}),
	title: Type.Optional(Type.String({ description: "Short title. Defaults to 'openagent'." })),
	level: Type.Optional(
		Type.Union([Type.Literal("info"), Type.Literal("warning"), Type.Literal("error")], {
			description: "Severity level for color coding. Defaults to 'info'.",
		}),
	),
});

const DESCRIPTION = [
	"Send a notification to the user via all active notification channels (TUI toast, terminal bell, OS notification).",
	"Use this to proactively inform the user about important milestones, completions, or issues.",
	"Do not use for routine status updates — only when the user would benefit from being alerted.",
].join(" ");

function levelToEvent(level: string): NotificationEvent {
	if (level === "error") return "toolError";
	if (level === "warning") return "longBash";
	return "agentEnd";
}

export function createNotifyTool(): ToolDefinition {
	return {
		name: "notify",
		label: "Notify",
		description: DESCRIPTION,
		promptSnippet: "notify — send a user notification",
		parameters: NotifyParams,
		async execute(_toolCallId, params) {
			const p = params as { message: string; title?: string; level?: string };
			const router = getGlobalRouter();
			if (!router) {
				return {
					content: [{ type: "text" as const, text: "通知系统未初始化" }],
					details: {},
				};
			}

			router.notify({
				event: levelToEvent(p.level ?? "info"),
				title: p.title ?? "openagent",
				message: p.message,
			});

			return {
				content: [{ type: "text" as const, text: "已通知" }],
				details: {},
			};
		},
	};
}
