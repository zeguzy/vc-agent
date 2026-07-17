import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { BackgroundJobRef } from "../background/service.js";

interface TaskToolsOptions {
	backgroundJobRef: BackgroundJobRef;
}

const PREVIEW_CHARS = 500;

function truncate(text: string, max: number): string {
	return text.length <= max ? text : `${text.slice(0, max - 3)}...`;
}

export function createTaskStatusTool(opts: TaskToolsOptions): ToolDefinition {
	return {
		name: "task_status",
		label: "Task Status",
		description: [
			"Check the status of background tasks you started with subagent(background=true).",
			"Without task_id: lists all background tasks (running and completed).",
			"With task_id: shows detailed status and output of a specific task.",
			"Use this when you need to check on background work — but remember you'll be automatically notified when a task completes, so don't poll unnecessarily.",
		].join(" "),
		parameters: Type.Object({
			task_id: Type.Optional(
				Type.String({
					description: "Specific task ID to check. Omit to list all background tasks.",
				}),
			),
		}),
		async execute(_toolCallId, rawParams) {
			const svc = opts.backgroundJobRef.current;
			if (!svc) {
				return {
					content: [{ type: "text", text: "Background job service not available." }],
					details: {},
				};
			}
			const params = rawParams as { task_id?: string };

			if (params.task_id) {
				const job = svc.get(params.task_id);
				if (!job) {
					return {
						content: [
							{
								type: "text",
								text: `Task ${params.task_id} not found. It may have been cleaned up.`,
							},
						],
						details: {},
					};
				}
				const lines = [
					`Task: ${job.title}`,
					`ID: ${job.id}`,
					`Status: ${job.status}`,
					`Type: ${job.type}`,
				];
				if (job.status === "completed" && job.output) {
					lines.push(`Output:\n${truncate(job.output, PREVIEW_CHARS)}`);
				}
				if (job.status === "error" && job.error) {
					lines.push(`Error: ${job.error}`);
				}
				return {
					content: [{ type: "text", text: lines.join("\n") }],
					details: {},
				};
			}

			const jobs = svc.list();
			if (jobs.length === 0) {
				return {
					content: [{ type: "text", text: "No background tasks." }],
					details: {},
				};
			}

			const lines = jobs.map((j) => {
				const preview =
					j.status === "completed" && j.output
						? truncate(j.output, 80)
						: j.status === "error" && j.error
							? truncate(j.error, 80)
							: "";
				return `- [${j.status}] ${j.id} · ${j.title}${preview ? ` → ${preview}` : ""}`;
			});
			return {
				content: [
					{
						type: "text",
						text: `Background tasks (${jobs.length}):\n${lines.join("\n")}`,
					},
				],
				details: {},
			};
		},
	};
}

export function createTaskCancelTool(opts: TaskToolsOptions): ToolDefinition {
	return {
		name: "task_cancel",
		label: "Task Cancel",
		description: [
			"Cancel a running background task by its task ID.",
			"The task is aborted immediately and its session is disposed.",
			"Only running tasks can be cancelled.",
		].join(" "),
		parameters: Type.Object({
			task_id: Type.String({
				description: "The task ID to cancel (returned when the background task was started).",
			}),
		}),
		async execute(_toolCallId, rawParams) {
			const svc = opts.backgroundJobRef.current;
			if (!svc) {
				return {
					content: [{ type: "text", text: "Background job service not available." }],
					details: {},
				};
			}
			const params = rawParams as { task_id: string };
			const job = svc.get(params.task_id);
			if (!job) {
				return {
					content: [{ type: "text", text: `Task ${params.task_id} not found.` }],
					details: {},
				};
			}
			if (job.status !== "running") {
				return {
					content: [
						{
							type: "text",
							text: `Task ${params.task_id} is already ${job.status}. Only running tasks can be cancelled.`,
						},
					],
					details: {},
				};
			}
			await svc.cancel(params.task_id);
			return {
				content: [
					{
						type: "text",
						text: `Task ${params.task_id} ("${job.title}") has been cancelled.`,
					},
				],
				details: {},
			};
		},
	};
}
