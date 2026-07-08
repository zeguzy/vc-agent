import type { SubagentToolDetails } from "./agents/types.js";

export type { SubagentToolDetails };
export type MessageRole = "user" | "assistant" | "tool" | "separator" | "worker";

export interface Message {
	id: string;
	role: MessageRole;
	content: string;
	thinking?: string;
	thinkingStreaming?: boolean;
	toolName?: string;
	toolArgs?: unknown;
	toolStatus?: "running" | "done" | "error";
	toolResult?: unknown;
	subagentDetails?: SubagentToolDetails;
	queued?: boolean;
	workerId?: string;
	workerAgent?: string;
	workerStatus?: "running" | "done" | "error" | "cancelled";
	workerError?: string;
	workerCost?: number;
	workerSummary?: string;
	workerModel?: string;
	workerTurns?: number;
	workerTokensIn?: number;
	workerTokensOut?: number;
	workerDurationMs?: number;
}

let _idCounter = 0;
export function nextId(): string {
	return `msg-${++_idCounter}`;
}

export function createUserMessage(text: string): Message {
	return { id: nextId(), role: "user", content: text };
}

export function createAssistantMessage(text: string = ""): Message {
	return { id: nextId(), role: "assistant", content: text };
}

export function createToolMessage(
	toolName: string,
	toolArgs: unknown,
	status: "running" | "done" | "error" = "running",
): Message {
	return {
		id: nextId(),
		role: "tool",
		content: "",
		toolName,
		toolArgs,
		toolStatus: status,
	};
}

export function createSeparator(): Message {
	return { id: nextId(), role: "separator", content: "" };
}

export function createWorkerMessage(
	workerId: string,
	agent: string,
	content: string = "",
): Message {
	return {
		id: nextId(),
		role: "worker",
		content,
		workerId,
		workerAgent: agent,
		workerStatus: "running",
	};
}
