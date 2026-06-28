import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export interface TodoItem {
	id: number;
	text: string;
	done: boolean;
}

export interface TodoDetails {
	action: string;
	todos: TodoItem[];
	nextId: number;
	error?: string;
}

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

const TodoParams = Type.Object({
	action: Type.Union([
		Type.Literal("list"),
		Type.Literal("add"),
		Type.Literal("toggle"),
		Type.Literal("clear"),
	]),
	text: Type.Optional(Type.String({ description: "Todo text (required for add)" })),
	id: Type.Optional(Type.Number({ description: "Todo ID (required for toggle)" })),
});

export function createTodoTool(): ToolDefinition {
	let todos: TodoItem[] = [];
	let nextId = 1;

	return {
		name: "todo",
		label: "Todo",
		description:
			"Create and manage a structured task list. Actions: list (show all), add (create with text), toggle (mark done/undone by id), clear (remove all). " +
			"ALWAYS use this tool when the user gives you a multi-step request — break it down into individual tasks and add them. " +
			"Track each step: add tasks before starting, mark them done with toggle as you complete them.",
		promptSnippet: "todo — MUST use for multi-step tasks (list/add/toggle/clear)",
		promptGuidelines: [
			"BEFORE starting any multi-step task, call todo with action='add' to create each step as a separate todo item.",
			"After you complete a step, call todo with action='toggle' and the step's id to mark it done.",
			"You can call todo with action='list' at any time to check progress.",
			"Always break user requests into concrete, actionable steps — not vague descriptions.",
		],
		parameters: TodoParams,
		async execute(_toolCallId, params) {
			const p = params as { action: string; text?: string; id?: number };

			switch (p.action) {
				case "list":
					return {
						content: [
							{
								type: "text" as const,
								text: todos.length
									? todos.map((t) => `[${t.done ? "x" : " "}] #${t.id}: ${t.text}`).join("\n")
									: "No todos",
							},
						],
						details: { action: "list", todos: [...todos], nextId } as TodoDetails,
					};

				case "add": {
					if (!p.text) {
						return {
							content: [{ type: "text" as const, text: "Error: text is required for add" }],
							details: {
								action: "add",
								todos: [...todos],
								nextId,
								error: "text required",
							} as TodoDetails,
						};
					}
					const item: TodoItem = { id: nextId++, text: p.text, done: false };
					todos.push(item);
					return {
						content: [{ type: "text" as const, text: `Added todo #${item.id}: ${item.text}` }],
						details: { action: "add", todos: [...todos], nextId } as TodoDetails,
					};
				}

				case "toggle": {
					if (p.id === undefined) {
						return {
							content: [{ type: "text" as const, text: "Error: id is required for toggle" }],
							details: {
								action: "toggle",
								todos: [...todos],
								nextId,
								error: "id required",
							} as TodoDetails,
						};
					}
					const item = todos.find((t) => t.id === p.id);
					if (!item) {
						return {
							content: [{ type: "text" as const, text: `Todo #${p.id} not found` }],
							details: {
								action: "toggle",
								todos: [...todos],
								nextId,
								error: `#${p.id} not found`,
							} as TodoDetails,
						};
					}
					item.done = !item.done;
					return {
						content: [
							{
								type: "text" as const,
								text: `Todo #${item.id} ${item.done ? "completed" : "uncompleted"}`,
							},
						],
						details: { action: "toggle", todos: [...todos], nextId } as TodoDetails,
					};
				}

				case "clear": {
					const count = todos.length;
					todos = [];
					nextId = 1;
					return {
						content: [{ type: "text" as const, text: `Cleared ${count} todos` }],
						details: { action: "clear", todos: [], nextId: 1 } as TodoDetails,
					};
				}

				default:
					return {
						content: [{ type: "text" as const, text: `Unknown action: ${p.action}` }],
						details: {
							action: "list",
							todos: [...todos],
							nextId,
							error: `unknown action: ${p.action}`,
						} as TodoDetails,
					};
			}
		},
	};
}
