import type { ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard, useRenderer } from "@opentui/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentSession, AgentSessionRuntime } from "../agent/session.js";
import { commandRegistry } from "../commands/registry.js";
import type { Config } from "../config.js";
import { createAssistantMessage, createUserMessage, type Message } from "../message.js";
import { PollManager } from "../poll/manager.js";
import { mapSdkMessagesToTui } from "../session/render.js";
import type { SettingContext } from "../settings/types.js";
import type { SkillManager } from "../skills/manager.js";
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
	runtime: AgentSessionRuntime;
	skillManager: SkillManager;
	model: string;
	cwd: string;
	config?: Config;
	initialResumeList?: boolean;
}

export function App({ runtime, skillManager, model, cwd, config, initialResumeList }: AppProps) {
	const renderer = useRenderer();
	const [session, setSession] = useState<AgentSession>(runtime.session);
	const initialMapped = mapSdkMessagesToTui(runtime.session.messages);
	const [messages, setMessages] = useState<Message[]>(
		initialMapped.length > 0 ? initialMapped : [WELCOME_MESSAGE],
	);
	const [commandHistory, setCommandHistory] = useState<string[]>(() => loadHistory());
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
	const [showSettings, setShowSettings] = useState(false);
	const [configState, setConfigState] = useState<Config>(config ?? {});
	const [copyFeedback, setCopyFeedback] = useState<{ ts: number } | null>(null);
	const scrollRef = useRef<ScrollBoxRenderable>(null);
	const pollManagerRef = useRef(new PollManager());

	// ── Custom hooks ──────────────────────────────────────────────
	const streaming = useStreamingBuffer();

	const picker = useSessionPicker(runtime, setMessages);

	const { toolCallIdToMsgId } = useSessionEvents(
		session,
		streaming,
		setMessages,
		setIsRunning,
		setContextUsage,
	);

	// ── Refs for mutable state access in callbacks ─────────────────
	const modeRef = useRef<Mode>("insert");
	modeRef.current = mode;
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

	// ── Effects ───────────────────────────────────────────────────
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
		runtime.setRebindSession(async (newSession) => {
			const mapped = mapSdkMessagesToTui(newSession.messages);
			setSession(newSession);
			setMessages(mapped.length > 0 ? mapped : [WELCOME_MESSAGE]);
			setIsRunning(false);
			toolCallIdToMsgId.current.clear();
			setContextUsage({ tokens: null, window: null, percent: null });
			const cu = newSession.getContextUsage();
			if (cu) {
				setContextUsage({
					tokens: cu.tokens ?? null,
					window: cu.contextWindow,
					percent: cu.percent ?? null,
				});
			}
			setTimeout(() => {
				const sb = scrollRef.current;
				if (sb) sb.scrollTo(sb.scrollHeight);
			}, 0);
		});
	}, [runtime, toolCallIdToMsgId]);

	const settingCtx: SettingContext = {
		session,
		settingsManager: session.settingsManager,
		modelRegistry: session.modelRegistry,
		authStorage: session.modelRegistry.authStorage,
		setUi: {
			thinkingCollapsed: setThinkingCollapsed,
			contextDisplay: setContextDisplay,
		},
		cwd,
	};

	const buildCommandCtx = useCallback(() => {
		return {
			session,
			runtime,
			skillManager,
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
		};
	}, [session, runtime, skillManager, cwd, picker.openSessionPicker]);

	useEffect(() => {
		if (!initialResumeList || resumeListDoneRef.current) return;
		if (commandRegistry.size === 0) return;
		resumeListDoneRef.current = true;
		commandRegistry.execute("sessions", "", buildCommandCtx()).catch(() => {});
	}, [initialResumeList, buildCommandCtx]);

	const handlePrompt = useCallback(
		(text: string) => {
			if (text.startsWith("/")) {
				const [cmd, ...args] = text.slice(1).split(/\s+/);
				const argStr = args.join(" ").trim();
				commandRegistry.execute(cmd, argStr, buildCommandCtx()).then((handled) => {
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
				session.followUp(text).catch((err) => {
					setMessages((prev) => [...prev, createAssistantMessage(`Error: ${formatError(err)}`)]);
				});
				return;
			}
			setMessages((prev) => [...prev, createUserMessage(text)]);
			setCommandHistory((prev) => [...prev, text]);
			saveHistory(text);
			session.prompt(text).catch((err) => {
				setMessages((prev) => [...prev, createAssistantMessage(`Error: ${formatError(err)}`)]);
				setIsRunning(false);
			});
		},
		[session, buildCommandCtx],
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
				if (isRunningRef.current) session.abort().catch(() => {});
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
			case "ctrlC": {
				const now = Date.now();
				if (now - lastCtrlCRef.current < 1000) process.exit(0);
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
	const isWelcome = messages.length === 1 && messages[0].id === WELCOME_MESSAGE.id;

	return (
		<box flexDirection="column" height={"100%"} backgroundColor={colors.background}>
			{isWelcome ? (
				<scrollbox flexGrow={1} scrollY stickyScroll stickyStart="bottom" focused={false}>
					<WelcomeBanner cwd={cwd} model={session.model?.name || session.model?.id || model} />
				</scrollbox>
			) : (
				<MessageList
					messages={messages.filter((m) => !m.queued)}
					scrollRef={scrollRef}
					thinkingCollapsed={thinkingCollapsed}
				/>
			)}
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
					currentId={session.sessionId}
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
					cwd={cwd}
					pollManager={pollManagerRef.current}
					onSubmit={handlePrompt}
					sentMessages={commandHistory}
				/>
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
