import { useEffect, useRef } from "react";
import type { AgentSession, AgentSessionEvent } from "../../agent/session.js";
import {
	createAssistantMessage,
	createSeparator,
	createToolMessage,
	type Message,
} from "../../message.js";
import { extractAssistantContent } from "../../utils/content.js";
import type { StreamingBuffer } from "./useStreamingBuffer.js";

interface SessionEventsState {
	toolCallIdToMsgId: React.MutableRefObject<Map<string, string>>;
}

/**
 * Subscribes to AgentSession events and maps them to TUI message state updates.
 *
 * Handles: agent_start, message_start, message_update (via StreamingBuffer),
 * message_end, tool_execution_start, tool_execution_end, agent_end,
 * compaction_start, compaction_end.
 *
 * The subscription is rebuilt whenever `session` changes (e.g. on hot-switch).
 */
export function useSessionEvents(
	session: AgentSession,
	streaming: StreamingBuffer,
	setMessages: (updater: Message[] | ((prev: Message[]) => Message[])) => void,
	setIsRunning: (running: boolean) => void,
	setContextUsage: (usage: {
		tokens: number | null;
		window: number | null;
		percent: null | number;
	}) => void,
	onToolEnd?: (toolName: string, result: unknown) => void,
): SessionEventsState {
	const toolCallIdToMsgId = useRef<Map<string, string>>(new Map());
	const onToolEndRef = useRef(onToolEnd);
	onToolEndRef.current = onToolEnd;

	useEffect(() => {
		function refreshContextUsage() {
			const usage = session.getContextUsage();
			setContextUsage({
				tokens: usage?.tokens ?? null,
				window: usage?.contextWindow ?? null,
				percent: usage?.percent ?? null,
			});
		}

		const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
			switch (event.type) {
				case "agent_start":
					setIsRunning(true);
					setMessages((prev) => prev.map((m) => (m.queued ? { ...m, queued: false } : m)));
					refreshContextUsage();
					break;

				case "message_start": {
					const msg = event.message as {
						role?: string;
						content?: string | Array<{ type: string; text?: string; thinking?: string }>;
					};
					if (msg?.role === "assistant") {
						const { text, thinking } = extractAssistantContent(msg.content);
						const newMsg = createAssistantMessage(text);
						if (thinking) newMsg.thinking = thinking;
						setMessages((prev) => [...prev, newMsg]);
					}
					break;
				}

				case "message_update": {
					const msg = event.message as {
						role?: string;
						content?: string | Array<{ type: string; text?: string; thinking?: string }>;
					};
					if (msg?.role === "assistant") {
						const { text, thinking } = extractAssistantContent(msg.content);
						streaming.setPending(text, thinking);
						streaming.scheduleUpdate(setMessages);
					}
					break;
				}

				case "message_end": {
					const msg = event.message as {
						role?: string;
						content?: string | Array<{ type: string; text?: string; thinking?: string }>;
					};
					if (msg?.role === "assistant") {
						const { text, thinking } = extractAssistantContent(msg.content);
						streaming.flush(setMessages, text, thinking);
					}
					break;
				}

				case "tool_execution_start": {
					if (event.toolName === "todo") break;
					const toolMsg = createToolMessage(event.toolName, event.args, "running");
					toolCallIdToMsgId.current.set(event.toolCallId, toolMsg.id);
					setMessages((prev) => [...prev, toolMsg]);
					break;
				}

				case "tool_execution_end": {
					const msgId = toolCallIdToMsgId.current.get(event.toolCallId);
					if (msgId) {
						setMessages((prev) =>
							prev.map((m) =>
								m.id === msgId
									? {
											...m,
											toolStatus: event.isError ? "error" : "done",
											toolResult: event.result,
										}
									: m,
							),
						);
					}
					onToolEndRef.current?.(event.toolName, event.result);
					refreshContextUsage();
					break;
				}

				case "compaction_start":
					setMessages((prev) => [...prev, createAssistantMessage("Compacting context…")]);
					break;

				case "compaction_end": {
					if (event.aborted) {
						setMessages((prev) => [...prev, createAssistantMessage("Compaction aborted")]);
					} else if (event.errorMessage) {
						setMessages((prev) => [
							...prev,
							createAssistantMessage(`Compaction failed: ${event.errorMessage}`),
						]);
					} else if (event.result) {
						const r = event.result;
						const afterPart =
							r.estimatedTokensAfter != null ? ` → ${r.estimatedTokensAfter} tokens` : "";
						const msg = `Context compacted: ${r.tokensBefore} tokens${afterPart}\n${r.summary}`;
						setMessages((prev) => [...prev, createAssistantMessage(msg)]);
					}
					refreshContextUsage();
					break;
				}

				case "agent_end":
					setIsRunning(false);
					setMessages((prev) => [...prev, createSeparator()]);
					refreshContextUsage();
					break;
			}
		});
		return unsubscribe;
	}, [session, streaming, setMessages, setIsRunning, setContextUsage]);

	return { toolCallIdToMsgId };
}
