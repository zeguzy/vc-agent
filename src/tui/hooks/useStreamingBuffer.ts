import { useRef } from "react";
import type { Message } from "../../message.js";

export interface StreamingBuffer {
	/** Schedule a throttled update with the latest pending text/thinking. */
	scheduleUpdate: (
		setMessages: (updater: Message[] | ((prev: Message[]) => Message[])) => void,
	) => void;
	/** Flush immediately - called on message_end. */
	flush: (
		setMessages: (updater: Message[] | ((prev: Message[]) => Message[])) => void,
		text: string,
		thinking?: string,
	) => void;
	/** Update the pending refs for the next throttled flush. */
	setPending: (text: string, thinking?: string, thinkingStreaming?: boolean) => void;
}

/**
 * Manages throttled streaming text updates.
 *
 * During message_update events, text is buffered and flushed at 80ms intervals
 * to avoid excessive React re-renders. On message_end, the buffer is flushed
 * immediately.
 */
export function useStreamingBuffer(): StreamingBuffer {
	const pendingTextRef = useRef<string | null>(null);
	const pendingThinkingRef = useRef<string | null>(null);
	const pendingThinkingStreamingRef = useRef<boolean>(false);
	const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const setPending = (text: string, thinking?: string, thinkingStreaming?: boolean) => {
		pendingTextRef.current = text;
		if (thinking !== undefined) pendingThinkingRef.current = thinking;
		pendingThinkingStreamingRef.current = !!thinkingStreaming;
	};

	const scheduleUpdate = (
		setMessages: (updater: Message[] | ((prev: Message[]) => Message[])) => void,
	) => {
		if (!flushTimerRef.current) {
			flushTimerRef.current = setTimeout(() => {
				flushTimerRef.current = null;
				const pending = pendingTextRef.current;
				const pendingThinking = pendingThinkingRef.current;
				const pendingThinkingStreaming = pendingThinkingStreamingRef.current;
				if (pending !== null) {
					pendingTextRef.current = null;
					pendingThinkingRef.current = null;
					setMessages((prev) => {
						const updated = [...prev];
						for (let i = updated.length - 1; i >= 0; i--) {
							if (updated[i].role === "assistant") {
								updated[i] = {
									...updated[i],
									content: pending,
									thinking: pendingThinking ?? undefined,
									thinkingStreaming: pendingThinkingStreaming,
								};
								break;
							}
						}
						return updated;
					});
				}
			}, 80);
		}
	};

	const flush = (
		setMessages: (updater: Message[] | ((prev: Message[]) => Message[])) => void,
		text: string,
		thinking?: string,
	) => {
		if (flushTimerRef.current) {
			clearTimeout(flushTimerRef.current);
			flushTimerRef.current = null;
		}
		pendingTextRef.current = null;
		pendingThinkingRef.current = null;
		setMessages((prev) => {
			const updated = [...prev];
			for (let i = updated.length - 1; i >= 0; i--) {
				if (updated[i].role === "assistant") {
					updated[i] = {
						...updated[i],
						content: text,
						thinking: thinking || undefined,
						thinkingStreaming: false,
					};
					break;
				}
			}
			return updated;
		});
	};

	return { scheduleUpdate, flush, setPending };
}
