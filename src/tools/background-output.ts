import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { TaskRegistry } from "../agents/task-registry.js";

interface BackgroundOutputToolOptions {
	registry: TaskRegistry;
}

const BackgroundOutputParams = Type.Object({
	task_id: Type.String({
		description: "background task ID (`bg_...`) from the launch response.",
	}),
	block: Type.Optional(
		Type.Boolean({
			description:
				"Wait for completion (default: false). System notifies on completion, so blocking is rarely needed.",
		}),
	),
	timeout: Type.Optional(
		Type.Integer({
			description: "Max wait time in ms (default: 60000, max: 600000).",
			minimum: 0,
			maximum: 600000,
		}),
	),
	full_session: Type.Optional(
		Type.Boolean({
			description:
				"Return full session messages with filters (default: false). Not yet implemented; returns stored result.",
		}),
	),
	from_end: Type.Optional(
		Type.Boolean({
			description:
				"Read messages from the END of the session (default: false). Requires full_session.",
		}),
	),
	message_limit: Type.Optional(
		Type.Integer({
			description: "Max messages to return (capped at 200). Requires full_session.",
			minimum: 1,
			maximum: 200,
		}),
	),
	since_message_id: Type.Optional(
		Type.String({
			description: "Return messages after this message ID (exclusive). Requires full_session.",
		}),
	),
	include_thinking: Type.Optional(
		Type.Boolean({
			description: "Include thinking/reasoning parts in full_session output (default: false).",
		}),
	),
	include_tool_results: Type.Optional(
		Type.Boolean({
			description: "Include tool results in full_session output (default: false).",
		}),
	),
});

const DESCRIPTION = [
	"Get output from a background task. Use after receiving a completion notification.",
	"Supports blocking wait, session message retrieval, and filtering options.",
].join(" ");

const DEFAULT_TIMEOUT_MS = 60000;
const MAX_TIMEOUT_MS = 600000;
const POLL_INTERVAL_MS = 500;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		if (signal?.aborted) {
			resolve();
			return;
		}
		const timer = setTimeout(resolve, ms);
		signal?.addEventListener(
			"abort",
			() => {
				clearTimeout(timer);
				resolve();
			},
			{ once: true },
		);
	});
}

export function createBackgroundOutputTool(options: BackgroundOutputToolOptions): ToolDefinition {
	const { registry } = options;

	return {
		name: "background_output",
		label: "Background Output",
		description: DESCRIPTION,
		promptSnippet: "background_output — fetch background task result",
		parameters: BackgroundOutputParams,
		async execute(_toolCallId, params, signal) {
			const p = params as {
				task_id: string;
				block?: boolean;
				timeout?: number;
				full_session?: boolean;
				from_end?: boolean;
				message_limit?: number;
				since_message_id?: string;
				include_thinking?: boolean;
				include_tool_results?: boolean;
			};

			const block = p.block ?? false;
			const timeout = Math.min(p.timeout ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);

			let task = registry.get(p.task_id);
			if (!task) {
				return {
					content: [{ type: "text" as const, text: `Task not found: ${p.task_id}` }],
					details: { taskId: p.task_id, status: "not_found", sessionId: undefined },
				};
			}

			// Block until terminal status or timeout (poll registry — status is updated by the runner).
			if (block && (task.status === "pending" || task.status === "running")) {
				const deadline = Date.now() + timeout;
				while (Date.now() < deadline && !signal?.aborted) {
					await sleep(POLL_INTERVAL_MS, signal);
					const next = registry.get(p.task_id);
					if (!next || (next.status !== "pending" && next.status !== "running")) {
						task = next;
						break;
					}
					task = next;
				}
			}

			if (!task) {
				return {
					content: [{ type: "text" as const, text: `Task not found: ${p.task_id}` }],
					details: { taskId: p.task_id, status: "not_found", sessionId: undefined },
				};
			}

			let text: string;
			switch (task.status) {
				case "completed":
					text = task.result ?? "(no result)";
					break;
				case "error":
					text = task.error ?? "Task failed with unknown error";
					break;
				case "cancelled":
					text = "Task was cancelled";
					break;
				case "pending":
				case "running":
					text = `Task is still ${task.status}.\n\nPartial result so far:\n${task.result ?? "(none yet)"}`;
					break;
			}

			return {
				content: [{ type: "text" as const, text }],
				details: {
					taskId: task.id,
					status: task.status,
					sessionId: task.sessionId,
				},
			};
		},
	};
}
