// SPDX-License-Identifier: AGPL-3.0-or-later
// Derived from opencode-dynamic-context-pruning v3.1.14 (https://github.com/Opencode-DCP/opencode-dynamic-context-pruning)
// Copyright (c) opencode-dcp contributors. Licensed under AGPL-3.0-or-later.

import type { MessagePart, WithParts } from "./core/state-types.js";

export type AgentMessage = {
	role: string;
	content: unknown;
	timestamp?: string;
	toolCallId?: string;
};

interface ContentBlock {
	type: string;
	text?: string;
	toolCallId?: string;
	toolName?: string;
	args?: unknown;
	output?: string;
}

function extractParts(content: Array<Record<string, unknown>>): MessagePart[] {
	const parts: MessagePart[] = [];
	for (const block of content) {
		const typed = block as unknown as ContentBlock;
		if (typed.type === "text" && typed.text) {
			parts.push({ type: "text", text: typed.text });
		} else if (typed.type === "toolCall" && typed.toolCallId) {
			parts.push({
				type: "tool",
				callID: typed.toolCallId,
				name: typed.toolName,
				input: typed.args,
			});
		} else if (typed.type === "toolResult" && typed.toolCallId) {
			parts.push({
				type: "tool_result",
				callID: typed.toolCallId,
				name: typed.toolName,
				output:
					typeof typed.output === "string" ? typed.output : JSON.stringify(typed.output ?? ""),
			});
		}
	}
	return parts;
}

export function toDcpMessages(messages: AgentMessage[], sessionId: string): WithParts[] {
	return messages.map((msg, index) => {
		const content = (msg.content ?? []) as Array<Record<string, unknown>>;
		const id = `m${String(index + 1).padStart(4, "0")}`;
		return {
			info: {
				id,
				role: msg.role,
				sessionId,
			},
			parts: extractParts(content),
		};
	});
}

export function fromDcpMessages(messages: WithParts[]): AgentMessage[] {
	return messages.map((msg) => {
		const content: Array<Record<string, unknown>> = [];
		for (const part of msg.parts) {
			if (part.type === "text" && part.text) {
				content.push({ type: "text", text: part.text });
			} else if (part.type === "tool" && part.callID) {
				content.push({
					type: "toolCall",
					toolCallId: part.callID,
					toolName: part.name,
					args: part.input,
				});
			} else if (part.type === "tool_result" && part.callID) {
				content.push({
					type: "toolResult",
					toolCallId: part.callID,
					toolName: part.name,
					output: part.output ?? "",
				});
			}
		}
		return {
			role: msg.info.role,
			content,
			timestamp: new Date().toISOString(),
		};
	});
}
