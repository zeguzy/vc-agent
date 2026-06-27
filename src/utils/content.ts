/**
 * Extract text and thinking content from a Pi SDK assistant message content blob.
 *
 * The SDK content may be a plain string (legacy) or an array of content blocks
 * (Anthropic-style: text / thinking / tool_use / tool_result).
 */
export function extractAssistantContent(content: unknown): { text: string; thinking: string } {
	if (typeof content === "string") return { text: content, thinking: "" };
	if (!Array.isArray(content)) return { text: "", thinking: "" };
	let text = "";
	let thinking = "";
	for (const c of content) {
		if (c?.type === "text" && typeof c.text === "string") text += c.text;
		else if (c?.type === "thinking" && typeof c.thinking === "string") thinking += c.thinking;
	}
	return { text, thinking };
}

/** Extract only the text portion of an assistant message. */
export function extractAssistantText(content: unknown): string {
	return extractAssistantContent(content).text;
}

/** Truncate tool arguments to a summary string for display. */
export function summarizeArgs(args: unknown, maxLen = 50): string {
	const str = typeof args === "string" ? args : JSON.stringify(args);
	if (str.length <= maxLen) return str;
	return `${str.slice(0, maxLen - 3)}...`;
}
