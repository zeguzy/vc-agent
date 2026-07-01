import type { ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard, useRenderer } from "@opentui/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentClient, AgentMode } from "../client/index.js";
import { commandRegistry } from "../commands/registry.js";
import type { Config } from "../config.js";
import { createAssistantMessage, createUserMessage, type Message } from "../message.js";
import { PollManager } from "../poll/manager.js";
import type { SettingContext } from "../settings/types.js";
import { formatError } from "../utils/formatError.js";
import { registerBuiltinCommands } from "./commands.js";
import { InputBox } from "./components/InputBox.js";
import { MessageList } from "./components/MessageList.js";
import { SessionPicker } from "./components/SessionPicker.js";
import { SettingsPanel } from "./components/SettingsPanel.js";
import { StatusBar } from "./components/StatusBar.js";
import { WelcomeBanner } from "./components/WelcomeBanner.js";
import { useSessionEvents } from "./hooks/useSessionEvents.js";
import { useSessionPicker } from "./hooks/useSessionPicker.js";
import { useStreamingBuffer } from "./hooks/useStreamingBuffer.js";
import { type Mode, resolveKey } from "./keymap.js";
import { getGitBranch, getGitDirty } from "./utils/git.js";
import { loadHistory, saveHistory } from "./utils/history.js";
import { copySelection } from "./utils/selection.js";
import { colors } from "./utils/theme.js";

const WELCOME_MESSAGE = createAssistantMessage("");

interface AppProps {
	client: AgentClient;
	model: string;
	cwd: string;
	config?: Config;
	initialResumeList?: boolean;
	initialAgentMode?: AgentMode;
}

export function App({ client, model, cwd, config, initialResumeList, initialAgentMode }: AppProps) {
	const renderer = useRenderer();
	const initialMapped = client.getMappedMessages();
	const [messages, setMessages] = useState<Message[]>(
		initialMapped.length > 0 ? initialMapped : [WELCOME_MESSAGE],
	);
	const [commandHistory, setCommandHistory] = useState<string[]>(() => loadHistory());
	const [isRunning, setIsRunning] = useState(false);
	const [mode, setMode] = useState<Mode>("insert");
	const [agentMode, setAgentMode] = useState<AgentMode>(initialAgentMode ?? "standard");
	const [thinkingCollapsed, setThinkingCollapsed] = useState(config?.thinking?.collapsed ?? false);
	const [contextUsage, setContextUsage] = useState<{
		tokens: number | null;
		window: number | null;
		percent: number | null;
	}>({ tokens: null, window: null, percent: null });
	const [contextDisplay, setContextDisplay] = useState<"compact" | "full">(
		config?.display?.contextMode ?? "compact",
	);
	const [showSettings, setShowSettings] = useState(false);
	const [configState, setConfigState] = useState<Config>(config ?? {});
	const [copyFeedback, setCopyFeedback] = useState<{ ts: number } | null>(null);
	const scrollRef = useRef<ScrollBoxRenderable>(null);
	const pollManagerRef = useRef(new PollManager());

	const streaming = useStreamingBuffer();
	const picker = useSessionPicker(client, setMessages);
	const { toolCallIdToMsgId } = useSessionEvents(
		client,
		streaming,
		setMessages,
		setIsRunning,
		setContextUsage,
	);

	const modeRef = useRef<Mode>("insert");
	modeRef.current = mode;
	const agentModeRef = useRef<AgentMode>(initialAgentMode ?? "standard");
	agentModeRef.current = agentMode;
	const isRunningRef = useRef(false);
	isRunningRef.current = isRunning;
	const messagesRef = useRef(messages);
	messagesRef.current = messages;
	const showSettingsRef = useRef(showSettings);
	showSettingsRef.current = showSettings;
	const showSessionPickerRef = useRef(false);
	showSessionPickerRef.current = picker.showSessionPicker;
	const configRef = useRef(configState);
	configRef.current = configState;
	const lastCtrlCRef = useRef<number>(0);
	const resumeListDoneRef = useRef(false);

	useEffect(() => {
		if (commandRegistry.size === 0) {
			registerBuiltinCommands();
		}
	}, []);

	useEffect(() => {
		pollManagerRef.current.register("git-branch", () => getGitBranch(cwd), 3000);
		pollManagerRef.current.register("git-dirty", () => getGitDirty(cwd), 3000);
		return () => {
			pollManagerRef.current.unregister("git-branch");
			pollManagerRef.current.unregister("git-dirty");
		};
	}, [cwd]);

	useEffect(() => {
		client.onSessionChange(async () => {
			const mapped = client.getMappedMessages();
			setMessages(mapped.length > 0 ? mapped : [WELCOME_MESSAGE]);
			setIsRunning(false);
			toolCallIdToMsgId.current.clear();
			setContextUsage({ tokens: null, window: null, percent: null });
			const cu = client.getContextUsage();
			if (cu) {
				setContextUsage({
					tokens: cu.tokens ?? null,
					window: cu.contextWindow ?? null,
					percent: cu.percent ?? null,
				});
			}
			setTimeout(() => {
				const sb = scrollRef.current;
				if (sb) sb.scrollTo(sb.scrollHeight);
			}, 0);
		});
	}, [client, toolCallIdToMsgId]);

	const settingCtx: SettingContext = {
		session: client.getSession(),
		settingsManager: client.getSettingsManager(),
		modelRegistry: client.getModelRegistry(),
		authStorage: client.getAuthStorage(),
		setUi: {
			thinkingCollapsed: setThinkingCollapsed,
			contextDisplay: setContextDisplay,
		},
		cwd,
	};

	const buildCommandCtx = useCallback(() => {
		return {
			client,
			messages: messagesRef.current,
			setMessages,
			setIsRunning,
			setContextUsage,
			setThinkingCollapsed,
			setContextDisplay,
			cwd,
			setShowSettings,
			getConfig: () => configRef.current,
			setConfig: setConfigState,
			openSessionPicker: picker.openSessionPicker,
			agentMode: agentModeRef.current,
			setAgentMode,
		};
	}, [client, cwd, picker.openSessionPicker]);

	useEffect(() => {
		if (!initialResumeList || resumeListDoneRef.current) return;
		if (commandRegistry.size === 0) return;
		resumeListDoneRef.current = true;
		client.executeCommand("sessions", "", buildCommandCtx()).catch(() => {});
	}, [initialResumeList, buildCommandCtx, client]);

	const handlePrompt = useCallback(
		(text: string) => {
			if (text.startsWith("/")) {
				const [cmd, ...args] = text.slice(1).split(/\s+/);
				const argStr = args.join(" ").trim();

				if (cmd.startsWith("skill:")) {
					setMessages((prev) => [...prev, createUserMessage(text)]);
					setCommandHistory((prev) => [...prev, text]);
					saveHistory(text);
					client.prompt(text).catch((err) => {
						setMessages((prev) => [...prev, createAssistantMessage(`Error: ${formatError(err)}`)]);
						setIsRunning(false);
					});
					return;
				}

				client.executeCommand(cmd, argStr, buildCommandCtx()).then((handled) => {
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
				setCommandHistory((prev) => [...prev, text]);
				saveHistory(text);
				client.followUp(text).catch((err) => {
					setMessages((prev) => [...prev, createAssistantMessage(`Error: ${formatError(err)}`)]);
				});
				return;
			}
			setMessages((prev) => [...prev, createUserMessage(text)]);
			setCommandHistory((prev) => [...prev, text]);
			saveHistory(text);
			client.prompt(text).catch((err) => {
				setMessages((prev) => [...prev, createAssistantMessage(`Error: ${formatError(err)}`)]);
				setIsRunning(false);
			});
		},
		[client, buildCommandCtx],
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
		if (showSettingsRef.current || showSessionPickerRef.current) {
			if (action === "ctrlC") {
				const now = Date.now();
				if (now - lastCtrlCRef.current < 1000) process.exit(0);
				lastCtrlCRef.current = now;
				if (isRunningRef.current) client.abort().catch(() => {});
				else process.exit(0);
			}
			return;
		}
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
			case "toggleAgentMode": {
				const next: AgentMode = agentModeRef.current === "standard" ? "planner" : "standard";
				client.setAgentMode(next);
				setAgentMode(next);
				setMessages((prev) => [
					...prev,
					createAssistantMessage(
						next === "planner"
							? "📋 Planner mode — edit/write tools disabled. Use Tab or /plan to switch back."
							: "▶ Standard mode — all tools available.",
					),
				]);
				return;
			}
			case "ctrlC": {
				const now = Date.now();
				if (now - lastCtrlCRef.current < 1000) process.exit(0);
				lastCtrlCRef.current = now;
				if (isRunningRef.current) {
					client.abort().catch(() => {});
				} else {
					process.exit(0);
				}
				return;
			}
		}
	});

	const modelDisplay = client.getModel()?.name || client.getModel()?.id || model;
	const queuedMsgs = messages.filter((m) => m.queued);
	const isWelcome = messages.length === 1 && messages[0].id === WELCOME_MESSAGE.id;

	return (
		<box flexDirection="column" height={"100%"} backgroundColor={colors.background}>
			{isWelcome ? (
				<scrollbox flexGrow={1} scrollY stickyScroll stickyStart="bottom" focused={false}>
					<WelcomeBanner cwd={cwd} model={modelDisplay} />
				</scrollbox>
			) : (
				<MessageList
					messages={messages.filter((m) => !m.queued)}
					scrollRef={scrollRef}
					thinkingCollapsed={thinkingCollapsed}
				/>
			)}
			{queuedMsgs.length > 0 && (
				<box flexShrink={0} paddingLeft={3} paddingRight={3}>
					<box
						borderStyle="rounded"
						border={["top", "right", "bottom", "left"]}
						borderColor={colors.borderSoft}
						backgroundColor={colors.backgroundInset}
						paddingLeft={1}
						paddingRight={1}
						flexDirection="column"
					>
						{queuedMsgs.map((msg) => (
							<box key={msg.id} flexDirection="row">
								<text fg={colors.secondary}>Queued → </text>
								<text fg={colors.textMuted}>{msg.content}</text>
							</box>
						))}
					</box>
				</box>
			)}
			{showSettings && (
				<SettingsPanel
					config={configState}
					ctx={settingCtx}
					onClose={() => setShowSettings(false)}
				/>
			)}
			{picker.showSessionPicker && (
				<SessionPicker
					sessions={picker.pickerSessions}
					currentId={client.getSessionId()}
					onSelect={picker.handlePickerSelect}
					onClose={picker.closeSessionPicker}
					onRename={picker.handlePickerRename}
				/>
			)}
			<box
				flexDirection="column"
				flexShrink={0}
				paddingLeft={1}
				paddingRight={1}
				paddingTop={1}
				paddingBottom={1}
			>
				<InputBox
					disabled={isRunning}
					mode={showSettings || picker.showSessionPicker ? "normal" : mode}
					agentMode={agentMode}
					cwd={cwd}
					pollManager={pollManagerRef.current}
					skillManager={client.getSkillManager()}
					onSubmit={handlePrompt}
					sentMessages={commandHistory}
				/>
				<StatusBar
					model={modelDisplay}
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
