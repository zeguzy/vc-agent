import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled";
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
 * Rebuild the todo list from the latest `todo` tool result in a message
 * history. Reads `toolResult.details.todos` from TUI tool messages.
 */
export function extractTodoItems(
	messages: Array<{ role?: string; toolName?: string; toolResult?: unknown }>,
): TodoItem[] {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.role === "tool" && msg.toolName === "todo" && msg.toolResult) {
			const d = (msg.toolResult as { details?: TodoDetails } | null | undefined)?.details;
			if (d && Array.isArray(d.todos)) return d.todos;
		}
	}
	return [];
}

const TodoStatusSchema = Type.Union([
	Type.Literal("pending"),
	Type.Literal("in_progress"),
	Type.Literal("completed"),
	Type.Literal("cancelled"),
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
	"Use proactively for 3+ step work. Keep exactly one item `in_progress` while working it; mark `completed` only when truly done, `cancelled` when a task is dropped or no longer relevant.",
	"Revise the list whenever scope changes: split an item into smaller steps, merge related ones, rewrite a vague description, or drop work that turned out unnecessary — don't let the list drift from reality.",
	"Statuses: pending | in_progress | completed | cancelled. Priorities: high | medium | low.",
].join(" ");

export function createTodoTool(): ToolDefinition {
	// Stable per-session id assignment. A task keeps its id as long as its
	// content stays the same across calls; changing content yields a new id
	// (treated as a fresh task). Ids are monotonic and never recycled.
	// Assumes contents are unique within a single list.
	const idByContent = new Map<string, number>();
	let nextId = 1;

	return {
		name: "todo",
		label: "Todo",
		description: DESCRIPTION,
		promptSnippet: "todo — full-list replace; one in_progress at a time; revise on scope change",
		parameters: TodoParams,
		async execute(_toolCallId, params) {
			const p = params as {
				todos: Array<{ content: string; status: TodoStatus; priority: TodoPriority }>;
			};
			const currentContents = new Set<string>();
			const todos: TodoItem[] = p.todos.map((t) => {
				currentContents.add(t.content);
				let id = idByContent.get(t.content);
				if (id === undefined) {
					id = nextId++;
					idByContent.set(t.content, id);
				}
				return {
					id,
					content: t.content,
					status: t.status,
					priority: t.priority,
				};
			});
			// Drop ids for tasks no longer present so a re-added task gets a
			// fresh id rather than resurrecting the old one.
			for (const key of idByContent.keys()) {
				if (!currentContents.has(key)) idByContent.delete(key);
			}
			const active = todos.filter(
				(t) => t.status !== "completed" && t.status !== "cancelled",
			).length;
			return {
				content: [
					{
						type: "text" as const,
						text: `${active} active todo${active === 1 ? "" : "s"}`,
					},
				],
				details: { todos } as TodoDetails,
			};
		},
	};
}
