import {
	createAssistantMessage,
	createSeparator,
	createToolMessage,
	createUserMessage,
	type Message,
} from "../message.js";
import { extractAssistantContent } from "../utils/content.js";

interface SdkContentBlock {
	type: string;
	text?: string;
	thinking?: string;
	name?: string;
	arguments?: unknown;
	id?: string;
}

interface SdkMessage {
	role?: string;
	content?: string | SdkContentBlock[];
	toolCallId?: string;
	toolName?: string;
	details?: unknown;
	isError?: boolean;
}

function extractUserText(content: SdkMessage["content"]): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.filter((b) => b?.type === "text" && typeof b.text === "string")
			.map((b) => (b.text as string) ?? "")
			.join("");
	}
	return "";
}

export function mapSdkMessagesToTui(sdkMessages: unknown): Message[] {
	if (!Array.isArray(sdkMessages)) return [];
	const messages = sdkMessages as SdkMessage[];

	const toolResults = new Map<string, SdkMessage>();
	for (const m of messages) {
		if (m?.role === "toolResult" && typeof m.toolCallId === "string") {
			toolResults.set(m.toolCallId, m);
		}
	}

	const out: Message[] = [];
	let prevRole: string | undefined;

	for (const m of messages) {
		const role = m?.role;
		if (role === "user") {
			if (prevRole === "assistant") out.push(createSeparator());
			const text = extractUserText(m.content);
			if (text) out.push(createUserMessage(text));
		} else if (role === "assistant") {
			const { text, thinking } = extractAssistantContent(m.content);
			const assistant = createAssistantMessage(text);
			if (thinking) assistant.thinking = thinking;
			out.push(assistant);
			if (Array.isArray(m.content)) {
				for (const block of m.content) {
					if (block?.type === "toolCall" && typeof block.name === "string") {
						const msg = createToolMessage(block.name, block.arguments, "done");
						if (typeof block.id === "string") {
							const result = toolResults.get(block.id);
							if (result) msg.toolResult = result;
						}
						out.push(msg);
					}
				}
			}
		}
		if (role === "user" || role === "assistant") prevRole = role;
	}

	return out;
}
