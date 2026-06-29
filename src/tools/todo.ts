import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export type TodoStatus = "pending" | "in_progress" | "completed";
export type TodoPriority = "high" | "medium" | "low";

export interface TodoItem {
	id: number;
	content: string;
	status: TodoStatus;
	priority: TodoPriority;
}

export interface TodoDetails {
	todos: TodoItem[];
}

/**
 * Rebuild the todo list from the latest `todo` tool result in a session's
 * message history. Used to restore state on session resume / hot-swap.
 */
export function extractTodoItems(
	messages: Array<{ role?: string; toolName?: string; details?: unknown }>,
): TodoItem[] {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.role === "toolResult" && msg.toolName === "todo" && msg.details) {
			const d = msg.details as TodoDetails;
			if (Array.isArray(d.todos)) return d.todos;
		}
	}
	return [];
}

const TodoStatusSchema = Type.Union([
	Type.Literal("pending"),
	Type.Literal("in_progress"),
	Type.Literal("completed"),
]);
const TodoPrioritySchema = Type.Union([
	Type.Literal("high"),
	Type.Literal("medium"),
	Type.Literal("low"),
]);
const TodoItemSchema = Type.Object({
	content: Type.String({ description: "Brief description of the task" }),
	status: TodoStatusSchema,
	priority: TodoPrioritySchema,
});

const TodoParams = Type.Object({
	todos: Type.Array(TodoItemSchema, {
		description: "The full updated todo list — replaces the previous list entirely on every call",
	}),
});

const DESCRIPTION = [
	"Maintain a structured task list for the session. Pass the FULL list every call — it replaces the previous one entirely.",
	"Use proactively for 3+ step work. Keep exactly one item `in_progress` while working it; mark `completed` only when truly done.",
	"Statuses: pending | in_progress | completed. Priorities: high | medium | low.",
].join(" ");

export function createTodoTool(): ToolDefinition {
	return {
		name: "todo",
		label: "Todo",
		description: DESCRIPTION,
		promptSnippet: "todo — full-list replace; one in_progress at a time",
		parameters: TodoParams,
		async execute(_toolCallId, params) {
			const p = params as {
				todos: Array<{ content: string; status: TodoStatus; priority: TodoPriority }>;
			};
			const todos: TodoItem[] = p.todos.map((t, i) => ({
				id: i + 1,
				content: t.content,
				status: t.status,
				priority: t.priority,
			}));
			return {
				content: [
					{
						type: "text" as const,
						text: `${todos.filter((t) => t.status !== "completed").length} active todo${todos.length === 1 ? "" : "s"}`,
					},
				],
				details: { todos } as TodoDetails,
			};
		},
	};
}
