import {
	createAssistantMessage,
	createSeparator,
	createToolMessage,
	createUserMessage,
	type Message,
} from "../message.js";
import { extractAssistantContent } from "../utils/content.js";

/**
 * Minimal structural shape of a Pi SDK message we read during restoration.
 *
 * The SDK message content is either a plain string or an array of content
 * blocks (Anthropic-style: text / thinking / tool_use / tool_result). We keep
 * the shape loose and degrade unknown blocks to plain text (see design.md
 * Decision 5).
 */
interface SdkContentBlock {
	type: string;
	text?: string;
	thinking?: string;
	name?: string;
	input?: unknown;
}
interface SdkMessage {
	role?: string;
	content?: string | SdkContentBlock[];
}

function extractUserText(content: SdkMessage["content"]): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		// Concatenate text blocks; ignore tool_result blocks (MVP renders tool
		// calls as summaries from the assistant turn that issued them).
		return content
			.filter((b) => b?.type === "text" && typeof b.text === "string")
			.map((b) => (b.text as string) ?? "")
			.join("");
	}
	return "";
}

/**
 * Map restored SDK messages to the TUI `Message[]` shape so a resumed /
 * hot-switched session renders its full history.
 *
 * - user     → createUserMessage(text)
 * - assistant→ createAssistantMessage(text) + thinking; each tool_use block
 *              becomes a createToolMessage(name, input, "done") summary
 * - a separator is inserted before each user turn that follows an assistant
 *   turn (mirrors the live `agent_end` separator behaviour)
 * - unknown roles / block types degrade to text, never throw
 *
 * Pure function for unit testing.
 */
export function mapSdkMessagesToTui(sdkMessages: unknown): Message[] {
	if (!Array.isArray(sdkMessages)) return [];
	const messages = sdkMessages as SdkMessage[];
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
					if (block?.type === "tool_use" && typeof block.name === "string") {
						out.push(createToolMessage(block.name, block.input, "done"));
					}
				}
			}
		}
		// Unknown roles (system/tool/etc.) are ignored at MVP — degrading to
		// text would mix non-conversational content into the transcript.
		if (role === "user" || role === "assistant") prevRole = role;
	}

	return out;
}
