import type { ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard, useRenderer } from "@opentui/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentSession, AgentSessionEvent } from "../agent/session.js";
import { extractAssistantContent } from "../agent/session.js";
import { commandRegistry } from "../commands/registry.js";
import type { Config } from "../config.js";
import type { SkillManager } from "../skills/manager.js";
import {
	createAssistantMessage,
	createSeparator,
	createToolMessage,
	createUserMessage,
	type Message,
} from "../store.js";
import { registerBuiltinCommands } from "./commands.js";
import { InputBox } from "./components/InputBox.js";
import { MessageList } from "./components/MessageList.js";
import { StatusBar } from "./components/StatusBar.js";
import { type Mode, resolveKey } from "./keymap.js";
import { copySelection } from "./selection.js";
import { colors } from "./theme.js";

interface AppProps {
	session: AgentSession;
	skillManager: SkillManager;
	model: string;
	cwd: string;
	config?: Config;
}

export function App({ session, skillManager, model, cwd, config }: AppProps) {
	const renderer = useRenderer();
	const [messages, setMessages] = useState<Message[]>([
		createAssistantMessage("Hi, I'm openagent. I can read and edit files, and run commands."),
	]);
	const [isRunning, setIsRunning] = useState(false);
	const [mode, setMode] = useState<Mode>("insert");
	const [thinkingCollapsed, setThinkingCollapsed] = useState(config?.thinking?.collapsed ?? false);
	const [contextUsage, setContextUsage] = useState<{
		tokens: number | null;
		window: number | null;
		percent: number | null;
	}>({ tokens: null, window: null, percent: null });
	const [contextDisplay, setContextDisplay] = useState<"compact" | "full">(
		config?.display?.contextMode ?? "compact",
	);
	const [copyFeedback, setCopyFeedback] = useState<{ ts: number } | null>(null);
	const lastCtrlCRef = useRef<number>(0);
	const toolCallIdToMsgId = useRef<Map<string, string>>(new Map());
	const scrollRef = useRef<ScrollBoxRenderable>(null);
	const pendingTextRef = useRef<string | null>(null);
	const pendingThinkingRef = useRef<string | null>(null);
	const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	// Register built-in commands once on mount
	useEffect(() => {
		if (commandRegistry.size === 0) {
			registerBuiltinCommands();
		}
	}, []);

	const modeRef = useRef<Mode>("insert");
	modeRef.current = mode;
	const isRunningRef = useRef(false);
	isRunningRef.current = isRunning;
	const messagesRef = useRef(messages);
	messagesRef.current = messages;

	useEffect(() => {
		const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
			switch (event.type) {
				case "agent_start":
					setIsRunning(true);
					setMessages((prev) => prev.map((m) => (m.queued ? { ...m, queued: false } : m)));
					break;
				case "message_start": {
					const msg = event.message as any;
					if (msg?.role === "assistant") {
						const { text, thinking } = extractAssistantContent(msg.content);
						const newMsg = createAssistantMessage(text);
						if (thinking) newMsg.thinking = thinking;
						setMessages((prev) => [...prev, newMsg]);
					}
					break;
				}
				case "message_update": {
					const msg = event.message as any;
					if (msg?.role === "assistant") {
						const { text, thinking } = extractAssistantContent(msg.content);
						pendingTextRef.current = text;
						pendingThinkingRef.current = thinking;
						if (!flushTimerRef.current) {
							flushTimerRef.current = setTimeout(() => {
								flushTimerRef.current = null;
								const pending = pendingTextRef.current;
								const pendingThinking = pendingThinkingRef.current;
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
												};
												break;
											}
										}
										return updated;
									});
								}
							}, 120);
						}
					}
					break;
				}
				case "message_end": {
					if (flushTimerRef.current) {
						clearTimeout(flushTimerRef.current);
						flushTimerRef.current = null;
					}
					pendingTextRef.current = null;
					pendingThinkingRef.current = null;
					const msg = event.message as any;
					if (msg?.role === "assistant") {
						const { text, thinking } = extractAssistantContent(msg.content);
						setMessages((prev) => {
							const updated = [...prev];
							for (let i = updated.length - 1; i >= 0; i--) {
								if (updated[i].role === "assistant") {
									updated[i] = { ...updated[i], content: text, thinking: thinking || undefined };
									break;
								}
							}
							return updated;
						});
					}
					break;
				}
				case "tool_execution_start": {
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
									? { ...m, toolStatus: event.isError ? "error" : "done", toolResult: event.result }
									: m,
							),
						);
					}
					break;
				}
				case "agent_end":
					setIsRunning(false);
					setMessages((prev) => [...prev, createSeparator()]);
					{
						const usage = session.getContextUsage();
						setContextUsage({
							tokens: usage?.tokens ?? null,
							window: usage?.contextWindow ?? null,
							percent: usage?.percent ?? null,
						});
					}
					break;
			}
		});
		return unsubscribe;
	}, [session]);

	const handlePrompt = useCallback(
		(text: string) => {
			if (text.startsWith("/")) {
				const [cmd, ...args] = text.slice(1).split(/\s+/);
				const argStr = args.join(" ").trim();

				// Build command context
				const ctx = {
					session,
					skillManager,
					messages: messagesRef.current,
					setMessages,
					setIsRunning,
					setContextUsage,
					setThinkingCollapsed,
					setContextDisplay,
				};

				commandRegistry.execute(cmd, argStr, ctx).then((handled) => {
					if (!handled) {
						setMessages((prev) => [
							...prev,
							createAssistantMessage(
								`Unknown command: /${cmd}. Type /help for available commands.`,
							),
						]);
					}
				});
				return;
			}
			if (isRunningRef.current) {
				const msg = createUserMessage(text);
				msg.queued = true;
				setMessages((prev) => [...prev, msg]);
				session.followUp(text).catch((err) => {
					setMessages((prev) => [
						...prev,
						createAssistantMessage(`Error: ${err instanceof Error ? err.message : String(err)}`),
					]);
				});
				return;
			}
			setMessages((prev) => [...prev, createUserMessage(text)]);
			session.prompt(text).catch((err) => {
				setMessages((prev) => [
					...prev,
					createAssistantMessage(`Error: ${err instanceof Error ? err.message : String(err)}`),
				]);
				setIsRunning(false);
			});
		},
		[session, skillManager],
	);

	useKeyboard((key) => {
		if (key.name === "c" && (key.ctrl || key.super)) {
			if (copySelection(renderer, () => setCopyFeedback({ ts: Date.now() }))) {
				return;
			}
		}
		if (key.name === "escape" && renderer?.getSelection()) {
			renderer.clearSelection();
			return;
		}

		const action = resolveKey(modeRef.current, key);
		if (!action) return;

		switch (action) {
			case "toNormal":
				setMode("normal");
				return;
			case "toInsert":
				setMode("insert");
				return;
			case "scrollDown":
				scrollRef.current?.scrollBy(2);
				return;
			case "scrollUp":
				scrollRef.current?.scrollBy(-2);
				return;
			case "scrollTop":
				scrollRef.current?.scrollTo(0);
				return;
			case "scrollBottom": {
				const sb = scrollRef.current;
				if (sb) sb.scrollTo(sb.scrollHeight);
				return;
			}
			case "toggleThinking":
				setThinkingCollapsed((v) => !v);
				return;
			case "ctrlC": {
				const now = Date.now();
				if (now - lastCtrlCRef.current < 1000) {
					process.exit(0);
				}
				lastCtrlCRef.current = now;
				if (isRunningRef.current) {
					session.abort().catch(() => {});
				} else {
					process.exit(0);
				}
				return;
			}
		}
	});

	const queuedMsg = messages.find((m) => m.queued);

	return (
		<box flexDirection="column" height={"100%"} backgroundColor={colors.background}>
			<MessageList
				messages={messages.filter((m) => !m.queued)}
				scrollRef={scrollRef}
				thinkingCollapsed={thinkingCollapsed}
			/>
			{queuedMsg && (
				<box flexShrink={0} paddingLeft={3} paddingRight={3}>
					<box
						borderStyle="rounded"
						border={["top", "right", "bottom", "left"]}
						borderColor={colors.borderSoft}
						backgroundColor={colors.backgroundInset}
						paddingLeft={1}
						paddingRight={1}
						flexDirection="row"
					>
						<text fg={colors.secondary}>Queued → </text>
						<text fg={colors.textMuted}>{queuedMsg.content}</text>
					</box>
				</box>
			)}
			<box
				flexDirection="column"
				flexShrink={0}
				paddingLeft={1}
				paddingRight={1}
				paddingTop={1}
				paddingBottom={1}
			>
				<InputBox disabled={isRunning} mode={mode} cwd={cwd} onSubmit={handlePrompt} />
				<StatusBar
					model={session.model?.name || session.model?.id || model}
					mode={mode}
					contextPercent={contextUsage.percent}
					contextTokens={contextUsage.tokens}
					contextWindow={contextUsage.window}
					contextDisplay={contextDisplay}
					copyFeedback={copyFeedback}
					onCopyFeedbackClear={() => setCopyFeedback(null)}
				/>
			</box>
		</box>
	);
}
