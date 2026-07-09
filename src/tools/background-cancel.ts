import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { TaskRegistry } from "../agents/task-registry.js";

interface BackgroundCancelToolOptions {
	registry: TaskRegistry;
}

const BackgroundCancelParams = Type.Object({
	task_id: Type.Optional(
		Type.String({
			description: "Task ID to cancel (required if all is not true).",
		}),
	),
	all: Type.Optional(
		Type.Boolean({
			description: "Cancel ALL running background tasks (default: false).",
		}),
	),
});

const DESCRIPTION =
	"Cancel running background task(s). Use all=true to cancel ALL before final answer.";

export function createBackgroundCancelTool(options: BackgroundCancelToolOptions): ToolDefinition {
	const { registry } = options;

	return {
		name: "background_cancel",
		label: "Background Cancel",
		description: DESCRIPTION,
		promptSnippet: "background_cancel — abort background task(s)",
		parameters: BackgroundCancelParams,
		async execute(_toolCallId, params) {
			const p = params as {
				task_id?: string;
				all?: boolean;
			};

			const cancelAll = p.all ?? false;

			if (cancelAll) {
				const running = registry
					.list()
					.filter((t) => t.status === "running" || t.status === "pending");
				for (const t of running) {
					registry.cancel(t.id);
				}
				const count = running.length;
				const summary =
					count > 0
						? `Cancelled ${count} background task(s): ${running.map((t) => t.id).join(", ")}`
						: "No running background tasks to cancel.";
				return {
					content: [{ type: "text" as const, text: summary }],
					details: { cancelledCount: count },
				};
			}

			if (!p.task_id) {
				return {
					content: [{ type: "text" as const, text: "Either task_id or all=true is required." }],
					details: { cancelledCount: 0 },
				};
			}

			const task = registry.get(p.task_id);
			if (!task) {
				return {
					content: [{ type: "text" as const, text: `Task not found: ${p.task_id}` }],
					details: { cancelledCount: 0 },
				};
			}

			if (task.status === "completed") {
				return {
					content: [{ type: "text" as const, text: `Task ${p.task_id} already completed.` }],
					details: { cancelledCount: 0 },
				};
			}

			// Mark cancelled in registry. Session abort is the runner's responsibility
			// (it owns the AgentSession and watches registry status). We only store IDs here.
			registry.cancel(p.task_id);
			return {
				content: [{ type: "text" as const, text: `Cancelled task ${p.task_id}.` }],
				details: { cancelledCount: 1 },
			};
		},
	};
}
