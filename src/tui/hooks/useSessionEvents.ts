import { useEffect, useRef } from "react";
import type { AgentSessionEvent } from "../../agent/session.js";
import type { AgentClient } from "../../client/index.js";
import {
	createAssistantMessage,
	createSeparator,
	createToolMessage,
	createWorkerMessage,
	type Message,
} from "../../message.js";
import type { AgentClientEvent } from "../../teams/types.js";
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
						if (thinking) {
							newMsg.thinking = thinking;
							newMsg.thinkingStreaming = !text;
						}
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
						streaming.setPending(text, thinking, !!(thinking && !text));
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

	const workerMsgMap = useRef<Map<string, string>>(new Map());
	const workerThrottles = useRef<
		Map<string, { text: string; agent: string; timer: ReturnType<typeof setTimeout> | null }>
	>(new Map());
	const applyWorkerTextRef = useRef<(id: string, agent: string, text: string) => void>(() => {});

	const flushWorkerText = (workerId: string) => {
		const entry = workerThrottles.current.get(workerId);
		if (!entry) return;
		workerThrottles.current.delete(workerId);
		applyWorkerTextRef.current(workerId, entry.agent, entry.text);
	};

	useEffect(() => {
		function applyWorkerText(workerId: string, workerAgent: string, text: string) {
			const existingId = workerMsgMap.current.get(workerId);
			if (existingId) {
				setMessages((prev) => prev.map((m) => (m.id === existingId ? { ...m, content: text } : m)));
			} else if (text) {
				const msg = createWorkerMessage(workerId, workerAgent, text);
				workerMsgMap.current.set(workerId, msg.id);
				setMessages((prev) => [...prev, msg]);
			}
		}
		applyWorkerTextRef.current = applyWorkerText;

		const onWorkerEvent = (event: AgentClientEvent) => {
			// Team status dashboard — render as visible code block
			if ((event as { type: string }).type === "team_status_update") {
				const text = (event as { text: string }).text;
				console.error("[tui] team_status_update received:", text.slice(0, 50));
				setMessages((prev) => {
					const filtered = prev.filter((m) => !m.id.startsWith("team-status-"));
					return [
						...filtered,
						{
							id: `team-status-${Date.now()}`,
							role: "assistant" as const,
							content: `\`\`\`\n${text}\n\`\`\``,
						},
					];
				});
				return;
			}

			if (event.type !== "team_worker_event") return;

			const { workerId, workerAgent, kind } = event;

			if (kind === "message_delta") {
				const msgContent = (event.payload as { message?: { content?: unknown } }).message?.content;
				const { text } = extractAssistantContent(msgContent);

				let entry = workerThrottles.current.get(workerId);
				if (!entry) {
					entry = { text, agent: workerAgent, timer: null };
					workerThrottles.current.set(workerId, entry);
				} else {
					entry.text = text;
				}

				if (!entry.timer) {
					entry.timer = setTimeout(() => {
						flushWorkerText(workerId);
					}, 80);
				}
			}

			if (kind === "message_end") {
				const entry = workerThrottles.current.get(workerId);
				if (entry?.timer) {
					clearTimeout(entry.timer);
					workerThrottles.current.delete(workerId);
				}
				const msgContent = (event.payload as { message?: { content?: unknown } }).message?.content;
				const { text } = extractAssistantContent(msgContent);
				applyWorkerText(workerId, workerAgent, text);

				const usage = (event.payload as { message?: { usage?: { cost?: { total?: number } } } })
					.message?.usage;
				const cost = usage?.cost?.total;

				const existingId = workerMsgMap.current.get(workerId);
				if (existingId && cost) {
					setMessages((prev) =>
						prev.map((m) =>
							m.id === existingId ? { ...m, workerCost: (m.workerCost ?? 0) + cost } : m,
						),
					);
				}
			}

			if (kind === "agent_end") {
				const existingId = workerMsgMap.current.get(workerId);
				if (existingId) {
					setMessages((prev) =>
						prev.map((m) => (m.id === existingId ? { ...m, workerStatus: "done" } : m)),
					);
				} else {
					const msg = createWorkerMessage(workerId, workerAgent, "");
					msg.workerStatus = "done";
					workerMsgMap.current.set(workerId, msg.id);
					setMessages((prev) => [...prev, msg]);
				}
			}

			if (kind === "error" || kind === "cancelled") {
				const workerError = event.lastError;
				const existingId = workerMsgMap.current.get(workerId);
				if (existingId) {
					setMessages((prev) =>
						prev.map((m) => (m.id === existingId ? { ...m, workerStatus: kind, workerError } : m)),
					);
				} else {
					const msg = createWorkerMessage(workerId, workerAgent, workerError ?? "");
					msg.workerStatus = kind;
					if (workerError) msg.workerError = workerError;
					workerMsgMap.current.set(workerId, msg.id);
					setMessages((prev) => [...prev, msg]);
				}
			}
		};

		const unsub = client.subscribeTeam(onWorkerEvent);
		return () => {
			unsub();
			for (const entry of workerThrottles.current.values()) {
				if (entry.timer) clearTimeout(entry.timer);
			}
			workerThrottles.current.clear();
		};
	}, [client, setMessages, flushWorkerText]);

	return { toolCallIdToMsgId };
}
