import { useEffect, useRef } from "react";
import type { AgentSessionEvent } from "../../agent/session.js";
import type { AgentClient } from "../../client/index.js";
import {
	createAssistantMessage,
	createSeparator,
	createToolMessage,
	type Message,
	type SubagentToolDetails,
} from "../../message.js";
import type { QuestionData } from "../../tools/question-bridge.js";
import { extractAssistantContent } from "../../utils/content.js";
import type { StreamingBuffer } from "./useStreamingBuffer.js";

interface SessionEventsState {
	toolCallIdToMsgId: React.MutableRefObject<Map<string, string>>;
}

export function useSessionEvents(
	client: AgentClient,
	streaming: StreamingBuffer,
	setMessages: (updater: Message[] | ((prev: Message[]) => Message[])) => void,
	setIsRunning: (running: boolean) => void,
	setContextUsage: (usage: {
		tokens: number | null;
		window: number | null;
		percent: null | number;
	}) => void,
	onQuestionAsked?: (data: QuestionData) => void,
): SessionEventsState {
	const toolCallIdToMsgId = useRef<Map<string, string>>(new Map());

	useEffect(() => {
		function refreshContextUsage() {
			const usage = client.getContextUsage();
			setContextUsage({
				tokens: usage?.tokens ?? null,
				window: usage?.contextWindow ?? null,
				percent: usage?.percent ?? null,
			});
		}

		const unsubscribe = client.subscribe((event: AgentSessionEvent) => {
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
					if (event.toolName === "question" && onQuestionAsked) {
						const args =
							typeof event.args === "string"
								? (JSON.parse(event.args) as QuestionData)
								: (event.args as QuestionData);
						onQuestionAsked(args);
					}
					const toolMsg = createToolMessage(event.toolName, event.args, "running");
					toolCallIdToMsgId.current.set(event.toolCallId, toolMsg.id);
					setMessages((prev) => [...prev, toolMsg]);
					break;
				}

				case "tool_execution_update": {
					const msgId = toolCallIdToMsgId.current.get(event.toolCallId);
					if (msgId) {
						setMessages((prev) =>
							prev.map((m) => (m.id === msgId ? { ...m, toolResult: event.partialResult } : m)),
						);
					}
					break;
				}

				case "tool_execution_end": {
					const msgId = toolCallIdToMsgId.current.get(event.toolCallId);
					if (msgId) {
						const isSubagent = event.toolName === "subagent";
						const details = isSubagent
							? (event.result as { details?: SubagentToolDetails })?.details
							: undefined;
						setMessages((prev) =>
							prev.map((m) =>
								m.id === msgId
									? {
											...m,
											toolStatus: event.isError ? "error" : "done",
											toolResult: event.result,
											...(details ? { subagentDetails: details } : {}),
										}
									: m,
							),
						);
					}
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
	}, [client, streaming, setMessages, setIsRunning, setContextUsage, onQuestionAsked]);

	return { toolCallIdToMsgId };
}
