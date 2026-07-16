import type { ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard, useRenderer } from "@opentui/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentSessionEvent } from "../agent/session.js";
import { buildAgentModeCycle, getBaseMode } from "../agent/session.js";
import type { AgentClient, AgentMode } from "../client/index.js";
import type { BtwBackgroundTaskInfo, TeamSummary } from "../client/types.js";
import { commandRegistry } from "../commands/registry.js";
import type { Config } from "../config.js";
import { readConfig } from "../config.js";
import type { McpManager } from "../mcp/manager.js";
import { createAssistantMessage, createUserMessage, type Message } from "../message.js";
import { resolveNotificationsConfig } from "../notifications/config.js";
import { getGlobalRouter } from "../notifications/notifier.js";
import { PollManager } from "../poll/manager.js";
import { mapSdkMessagesToTui } from "../session/render.js";
import type { SettingContext } from "../settings/types.js";
import type { Goal, MemberState, TeamMdStructure } from "../teams/types-v2.js";
import type { QuestionBridge, QuestionData } from "../tools/question-bridge.js";
import { formatError } from "../utils/formatError.js";
import { registerBuiltinCommands } from "./commands.js";
import { InputBox } from "./components/InputBox.js";
import { MessageList } from "./components/MessageList.js";
import { QuestionBox } from "./components/QuestionBox.js";
import { SessionPicker } from "./components/SessionPicker.js";
import { SettingsPanel } from "./components/SettingsPanel.js";
import { StatusBar } from "./components/StatusBar.js";
import { TeamDashboard } from "./components/TeamDashboard.js";
import { TeamTopology } from "./components/TeamTopology.js";
import { Toast } from "./components/Toast.js";
import { WelcomeBanner } from "./components/WelcomeBanner.js";
import { WorkersView } from "./components/WorkersView.js";
import { useSessionEvents } from "./hooks/useSessionEvents.js";
import { useSessionPicker } from "./hooks/useSessionPicker.js";
import { useStreamingBuffer } from "./hooks/useStreamingBuffer.js";
import { useToasts } from "./hooks/useToasts.js";
import { type Mode, resolveKey } from "./keymap.js";
import { copyToClipboard } from "./utils/clipboard.js";
import { getGitBranch, getGitDirty } from "./utils/git.js";
import { loadHistory, saveHistory } from "./utils/history.js";
import { copySelection } from "./utils/selection.js";
import { colors } from "./utils/theme.js";
import { createVimOverlay, type VimOverlay } from "./vim/index.js";

const WELCOME_MESSAGE = createAssistantMessage("");

interface AppProps {
	client: AgentClient;
	model: string;
	cwd: string;
	config?: Config;
	bridge?: QuestionBridge;
	initialResumeList?: boolean;
	initialAgentMode?: AgentMode;
	mcpManager?: McpManager;
}

export function App({
	client,
	model,
	cwd,
	config,
	bridge,
	initialResumeList,
	initialAgentMode,
	mcpManager,
}: AppProps) {
	const renderer = useRenderer();
	const initialMapped = client.getMappedMessages();
	const [messages, setMessages] = useState<Message[]>(
		initialMapped.length > 0 ? initialMapped : [WELCOME_MESSAGE],
	);
	const [commandHistory, setCommandHistory] = useState<string[]>([]);
	const [pendingInput, setPendingInput] = useState<{ text: string; nonce: number } | null>(null);
	const [isRunning, setIsRunning] = useState(false);
	const [mode, setMode] = useState<Mode>("insert");
	const [agentMode, setAgentMode] = useState<AgentMode>(initialAgentMode ?? "standard");
	const [thinkingCollapsed, setThinkingCollapsed] = useState(config?.thinking?.collapsed ?? false);
	const [contextUsage, setContextUsage] = useState<{
		tokens: number | null;
		window: number | null;
		percent: number | null;
	}>({ tokens: null, window: null, percent: null });
	const [showSettings, setShowSettings] = useState(false);
	const [showWorkers, setShowWorkers] = useState(false);
	const [configState, setConfigState] = useState<Config>(config ?? {});
	const [toastDismissMs, setToastDismissMs] = useState(
		resolveNotificationsConfig(config?.notifications).toastDismissMs,
	);
	const [copyFeedback, setCopyFeedback] = useState<{ ts: number } | null>(null);
	const [pendingQuestion, setPendingQuestion] = useState<QuestionData | null>(null);
	const [activeMemberName, setActiveMemberName] = useState<string | null>(null);
	const [_memberTick, setMemberTick] = useState(0);
	const activeMemberMsgMapRef = useRef<Map<string, Message>>(new Map());
	const [btwTask, setBtwTask] = useState<BtwBackgroundTaskInfo | null>(null);
	const [_btwTick, setBtwTick] = useState(0);
	const [members, setMembers] = useState<MemberState[]>(() => client.listMembers());
	const membersRef = useRef<MemberState[]>(members);
	membersRef.current = members;
	const [goals, setGoals] = useState<Goal[]>(() => client.listGoals());
	const [teamMd, setTeamMd] = useState<TeamMdStructure>(() => client.readTeamMd());
	const [teamSummaries, setTeamSummaries] = useState<TeamSummary[]>(() =>
		client.listTeamSummaries(),
	);
	const [showDashboard, setShowDashboard] = useState(false);
	const showDashboardRef = useRef(false);
	showDashboardRef.current = showDashboard;
	const [dashboardSection, setDashboardSection] = useState<"goals" | "members" | "tasks" | "teams">(
		"members",
	);
	const [dashboardCursor, setDashboardCursor] = useState(0);
	const scrollRef = useRef<ScrollBoxRenderable>(null);
	const vimOverlayRef = useRef<VimOverlay | null>(null);
	const pollManagerRef = useRef(new PollManager());

	const streaming = useStreamingBuffer();
	const picker = useSessionPicker(client, setMessages);
	const { toolCallIdToMsgId } = useSessionEvents(
		client,
		streaming,
		setMessages,
		setIsRunning,
		setContextUsage,
		bridge ? setPendingQuestion : undefined,
	);

	useEffect(() => {
		const teamsEnabled = configState.teams?.enabled !== false;
		const expected: AgentMode = teamsEnabled ? "team" : "standard";
		if (agentMode !== expected && (agentMode === "standard" || agentMode === "team")) {
			setAgentMode(expected);
			client.setAgentMode(expected);
		}
	}, [configState.teams?.enabled, client, agentMode]);

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
	const showWorkersRef = useRef(showWorkers);
	showWorkersRef.current = showWorkers;
	const pendingQuestionRef = useRef<QuestionData | null>(null);
	pendingQuestionRef.current = pendingQuestion;
	const showSessionPickerRef = useRef(false);
	showSessionPickerRef.current = picker.showSessionPicker;
	const configRef = useRef(configState);
	configRef.current = configState;
	const activeMemberNameRef = useRef<string | null>(null);
	activeMemberNameRef.current = activeMemberName;
	const btwTaskRef = useRef<BtwBackgroundTaskInfo | null>(null);
	btwTaskRef.current = btwTask;
	const lastCtrlCRef = useRef<number>(0);
	const resumeListDoneRef = useRef(false);

	const { toast, pushToast } = useToasts(toastDismissMs);
	const toastPushRef = useRef(pushToast);
	toastPushRef.current = pushToast;

	// Real-time: subscribe to active member's session and stream messages into view
	useEffect(() => {
		if (!activeMemberName) return;
		const member = client.getMember(activeMemberName);
		if (!member) return;

		// Build initial snapshot
		const initial = mapSdkMessagesToTui(member.session.messages);
		activeMemberMsgMapRef.current.clear();
		for (const m of initial) {
			activeMemberMsgMapRef.current.set(m.id, m);
		}
		setMemberTick(Date.now());

		const flushToView = () => {
			const latest = mapSdkMessagesToTui(member.session.messages);
			if (latest.length === 0) return;
			// Only update if messages actually changed (avoid no-op re-renders)
			const prevLen = activeMemberMsgMapRef.current.size;
			if (latest.length !== prevLen || latest[latest.length - 1]?.content !== "") {
				activeMemberMsgMapRef.current.clear();
				for (const m of latest) {
					activeMemberMsgMapRef.current.set(m.id, m);
				}
				setMemberTick(Date.now());
			}
		};

		let throttled: ReturnType<typeof setTimeout> | null = null;

		const unsub = member.session.subscribe((event: AgentSessionEvent) => {
			switch (event.type) {
				case "agent_end":
				case "message_end": {
					// Immediately flush on completion
					if (throttled) {
						clearTimeout(throttled);
						throttled = null;
					}
					flushToView();
					break;
				}
				default: {
					// Throttle streaming updates to 120ms
					if (!throttled) {
						throttled = setTimeout(() => {
							throttled = null;
							flushToView();
						}, 120);
					}
					break;
				}
			}
		});

		return () => {
			unsub();
			if (throttled) {
				clearTimeout(throttled);
				throttled = null;
			}
			activeMemberMsgMapRef.current.clear();
		};
	}, [activeMemberName, client]);

	// Real-time: subscribe to btw side session and stream messages into view
	useEffect(() => {
		const sideSession = btwTask?.sideSession;
		if (!sideSession) return;

		setBtwTick(Date.now());

		let throttled: ReturnType<typeof setTimeout> | null = null;
		const flushToView = () => setBtwTick(Date.now());

		const unsub = sideSession.subscribe((event: AgentSessionEvent) => {
			switch (event.type) {
				case "agent_end":
				case "message_end": {
					if (throttled) {
						clearTimeout(throttled);
						throttled = null;
					}
					flushToView();
					break;
				}
				default: {
					if (!throttled) {
						throttled = setTimeout(() => {
							throttled = null;
							flushToView();
						}, 120);
					}
					break;
				}
			}
		});

		return () => {
			unsub();
			if (throttled) {
				clearTimeout(throttled);
				throttled = null;
			}
		};
	}, [btwTask]);

	// Poll btwStatus to sync bg-task completion into TUI state (server-side
	// status flips when the monitor fires; the TUI has no direct subscription).
	useEffect(() => {
		if (!btwTask) return;
		const interval = setInterval(() => {
			const status = client.btwStatus();
			if (!status.active) {
				setBtwTask(null);
				return;
			}
			if (status.status && status.status !== btwTask.status) {
				setBtwTask({ ...btwTask, status: status.status });
			}
		}, 2000);
		return () => clearInterval(interval);
	}, [btwTask, client]);

	// Keep members list in sync with team events
	useEffect(() => {
		const unsub = client.subscribeTeam(() => {
			setMembers(client.listMembers());
			setGoals(client.listGoals());
			setTeamMd(client.readTeamMd());
		});
		return unsub;
	}, [client]);

	// Auto-show dashboard on splash when team exists
	useEffect(() => {
		const welcome =
			messagesRef.current.length === 1 && messagesRef.current[0].id === WELCOME_MESSAGE.id;
		if (welcome && members.length > 0 && !showDashboardRef.current) {
			setShowDashboard(true);
		}
		if (!welcome && showDashboardRef.current) {
			setShowDashboard(false);
		}
	}, [members.length]);

	// Derive display messages: btw side session > member > main
	const displayMessages = useMemo(() => {
		const sideSession = btwTask?.sideSession;
		if (sideSession) {
			const sideMsgs = mapSdkMessagesToTui(sideSession.messages);
			if (sideMsgs.length === 0) {
				return [createAssistantMessage("Side conversation started. Background task is running...")];
			}
			return sideMsgs;
		}
		if (!activeMemberName) {
			return messages;
		}
		const member = client.getMember(activeMemberName);
		if (!member) {
			setActiveMemberName(null);
			return messages;
		}
		const memberMsgs = mapSdkMessagesToTui(member.session.messages);
		if (memberMsgs.length === 0) {
			return [createAssistantMessage(`No messages yet. ${activeMemberName} is working...`)];
		}
		return memberMsgs;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [btwTask, activeMemberName, messages, client]);

	useEffect(() => {
		const router = getGlobalRouter();
		if (!router) return;
		router.setRenderer(renderer);
		router.setToastHandler(toastPushRef.current);
		return () => {
			router.setToastHandler(undefined);
		};
	}, [renderer]);

	useEffect(() => {
		if (!renderer) return;
		vimOverlayRef.current = createVimOverlay({
			renderer,
			getBounds: () => {
				const vp = scrollRef.current?.viewport;
				if (!vp) return { x: 0, y: 0, width: 0, height: 0 };
				return { x: vp.screenX, y: vp.screenY, width: vp.width, height: vp.height };
			},
			scrollBy: (delta: number) => scrollRef.current?.scrollBy(delta),
			scrollToBottom: () => {
				const sb = scrollRef.current;
				if (!sb) return;
				// stickyScroll 大距离滚动后可能把 scrollTop 拉回中部，临时禁用确保到底
				const wasSticky = sb.stickyScroll;
				sb.stickyScroll = false;
				sb.scrollTo(sb.scrollHeight);
				sb.stickyScroll = wasSticky;
			},
			scrollToTop: () => {
				const sb = scrollRef.current;
				if (!sb) return;
				const wasSticky = sb.stickyScroll;
				sb.stickyScroll = false;
				sb.scrollTo(0);
				sb.stickyScroll = wasSticky;
			},
			onYank: (text: string) => {
				copyToClipboard(text);
				const lines = text.split("\n").length;
				toastPushRef.current({
					event: "yank",
					title: "Yanked",
					message: lines > 1 ? `${lines} lines` : `${[...text].length} chars`,
					toastOnly: true,
				});
			},
			getInitialCursorText: () => {
				const userMsgs = messagesRef.current.filter((m) => m.role === "user" && !m.queued);
				const latest = userMsgs[userMsgs.length - 1];
				if (!latest?.content) return null;
				return [...latest.content].slice(0, 15).join("");
			},
			getFirstUserMessageText: () => {
				const userMsgs = messagesRef.current.filter((m) => m.role === "user" && !m.queued);
				const first = userMsgs[0];
				if (!first?.content) return null;
				return [...first.content.split("\n")[0]].slice(0, 25).join("").trim();
			},
		});
		return () => {
			vimOverlayRef.current?.cleanup();
			vimOverlayRef.current = null;
		};
	}, [renderer]);

	useEffect(() => {
		const overlay = vimOverlayRef.current;
		if (!overlay) return;
		if (mode === "normal") {
			overlay.activate();
		} else {
			overlay.deactivate();
		}
	}, [mode]);

	useEffect(() => {
		if (commandRegistry.size === 0) {
			registerBuiltinCommands();
		}
	}, []);

	// Load history async to avoid blocking first paint
	useEffect(() => {
		setCommandHistory(loadHistory());
	}, []);

	useEffect(() => {
		pollManagerRef.current.register("git-branch", () => getGitBranch(cwd), 3000);
		pollManagerRef.current.register("git-dirty", () => getGitDirty(cwd), 3000);
		pollManagerRef.current.register(
			"mcp-status",
			() => {
				const statuses = mcpManager?.getConnectionStatus() ?? [];
				const total = statuses.length;
				const hasFailed = statuses.some((s) => s.status === "failed");
				return `${total}:${hasFailed}`;
			},
			5000,
		);
		return () => {
			pollManagerRef.current.unregister("git-branch");
			pollManagerRef.current.unregister("git-dirty");
			pollManagerRef.current.unregister("mcp-status");
		};
	}, [cwd, mcpManager]);

	useEffect(() => {
		client.onSessionChange(async () => {
			const mapped = client.getMappedMessages();
			setMessages(mapped.length > 0 ? mapped : [WELCOME_MESSAGE]);
			setIsRunning(false);
			toolCallIdToMsgId.current.clear();
			setContextUsage({ tokens: null, window: null, percent: null });
			setMembers(client.listMembers());
			setActiveMemberName(null);
			setBtwTask(null);
			setGoals(client.listGoals());
			setTeamMd(client.readTeamMd());
			setTeamSummaries(client.listTeamSummaries());
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
		client,
		setUi: {
			thinkingCollapsed: setThinkingCollapsed,
			toastDismissMs: setToastDismissMs,
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
			cwd,
			setShowSettings,
			setShowWorkers,
			getConfig: () => configRef.current,
			setConfig: setConfigState,
			openSessionPicker: picker.openSessionPicker,
			agentMode: agentModeRef.current,
			setAgentMode,
			setInputText: (text: string) => setPendingInput({ text, nonce: Date.now() }),
			isRunning: isRunningRef.current,
			mcpManager,
			setBtwBackgroundTask: setBtwTask,
		};
	}, [client, cwd, picker.openSessionPicker, mcpManager]);

	useEffect(() => {
		if (!initialResumeList || resumeListDoneRef.current) return;
		if (commandRegistry.size === 0) return;
		resumeListDoneRef.current = true;
		client.executeCommand("sessions", "", buildCommandCtx()).catch(() => {});
	}, [initialResumeList, buildCommandCtx, client]);

	const handleMemberNav = useCallback((direction: "prev" | "next") => {
		if (agentModeRef.current !== "team") return;
		const list = [null, ...membersRef.current.map((m) => m.name)];
		const currentIdx = list.indexOf(activeMemberNameRef.current);
		const nextIdx =
			direction === "next"
				? (currentIdx + 1) % list.length
				: (currentIdx - 1 + list.length) % list.length;
		setActiveMemberName(list[nextIdx]);
	}, []);

	const handlePrompt = useCallback(
		(text: string) => {
			// Route to btw side session when in side view
			const btwSide = btwTaskRef.current?.sideSession;
			if (btwSide) {
				client.btwSidePrompt(text);
				setCommandHistory((prev) => [...prev, text]);
				saveHistory(text);
				return;
			}
			// Route to member when in member sub-session view
			if (activeMemberNameRef.current) {
				client.directMember(activeMemberNameRef.current, "directive", text);
				setCommandHistory((prev) => [...prev, text]);
				saveHistory(text);
				return;
			}

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
				const sendMsg = () => {
					client.prompt(text).catch((err) => {
						setMessages((prev) => [...prev, createAssistantMessage(`Error: ${formatError(err)}`)]);
						setIsRunning(false);
					});
				};
				client.abort().then(sendMsg, sendMsg);
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
		if (pendingQuestionRef.current) {
			const action = resolveKey("insert", key);
			if (action === "ctrlC") {
				setPendingQuestion(null);
			} else {
				return;
			}
		}
		if (key.name === "escape" && renderer?.getSelection()) {
			renderer.clearSelection();
			return;
		}
		if (modeRef.current === "normal" && !key.ctrl && !key.super) {
			const overlay = vimOverlayRef.current;
			if (overlay) {
				const keyStr =
					key.name === "escape" ? "escape" : key.sequence?.length === 1 ? key.sequence : key.name;
				if (overlay.handleKey(keyStr)) return;
			}
		}
		const action = resolveKey(modeRef.current, key);
		if (showSettingsRef.current || showSessionPickerRef.current || showWorkersRef.current) {
			if (action === "ctrlC") {
				const now = Date.now();
				if (now - lastCtrlCRef.current < 1000) process.exit(0);
				lastCtrlCRef.current = now;
				if (isRunningRef.current) client.abort().catch(() => {});
				else process.exit(0);
			}
			return;
		}
		if (showDashboardRef.current) {
			if (action === "toggleDashboard") {
				setShowDashboard(false);
				return;
			}
			if (action === "ctrlC") {
				const now = Date.now();
				if (now - lastCtrlCRef.current < 1000) process.exit(0);
				lastCtrlCRef.current = now;
				if (isRunningRef.current) client.abort().catch(() => {});
				else process.exit(0);
				return;
			}
			if (action === "toNormal") return;
			if (key.name === "j" || key.name === "k") {
				const currentMembers = membersRef.current;
				const currentGoals = goals;
				const currentTasks = client.listTasks();
				const otherTeamsCount = isWelcome
					? teamSummaries.filter((s) => s.sessionId !== client.getSessionId()).length
					: 0;
				const sectionSizes: Record<string, number> = {
					goals: currentGoals.length,
					members: currentMembers.length,
					tasks: currentTasks.length,
					teams: otherTeamsCount,
				};
				const size = sectionSizes[dashboardSection] ?? 0;
				if (size > 0) {
					setDashboardCursor((i) => (key.name === "j" ? (i + 1) % size : (i - 1 + size) % size));
				}
				return;
			}
			if (key.name === "tab") {
				const sectionKeys = ["goals", "members", "tasks", "teams"] as const;
				const available = sectionKeys.filter((k) => {
					if (k === "goals") return goals.length > 0;
					if (k === "members") return membersRef.current.length > 0;
					if (k === "tasks") return client.listTasks().length > 0;
					if (k === "teams")
						return (
							isWelcome &&
							teamSummaries.filter((s) => s.sessionId !== client.getSessionId()).length > 0
						);
					return false;
				});
				if (available.length > 0) {
					const idx = available.indexOf(dashboardSection);
					const next = available[(idx + 1) % available.length];
					setDashboardSection(next as "goals" | "members" | "tasks" | "teams");
					setDashboardCursor(0);
				}
				return;
			}
			if (key.name === "return") {
				const currentMembers = membersRef.current;
				const otherTeams = isWelcome
					? teamSummaries.filter((s) => s.sessionId !== client.getSessionId())
					: [];
				if (dashboardSection === "members" && currentMembers[dashboardCursor]) {
					setActiveMemberName(currentMembers[dashboardCursor].name);
					setShowDashboard(false);
				} else if (dashboardSection === "teams" && otherTeams[dashboardCursor]) {
					client.switchSession(`sqlite://${otherTeams[dashboardCursor].sessionId}`).catch(() => {});
				}
				return;
			}
			if (key.name === "d") {
				const currentMembers = membersRef.current;
				if (dashboardSection === "members" && currentMembers[dashboardCursor]) {
					setActiveMemberName(currentMembers[dashboardCursor].name);
					setShowDashboard(false);
				}
				return;
			}
			if (key.name === "escape" || key.name === "i") {
				setShowDashboard(false);
				return;
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
				const cycle = buildAgentModeCycle(configRef.current);
				const next = cycle[agentModeRef.current] ?? getBaseMode(configRef.current);
				client.setAgentMode(next);
				setAgentMode(next);
				return;
			}
			case "prevMember":
				handleMemberNav("prev");
				return;
			case "nextMember":
				handleMemberNav("next");
				return;
			case "toggleDashboard":
				setShowDashboard((v) => !v);
				return;
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

	const resolvedModel = client.getModel();
	const modelDisplay = resolvedModel?.name || resolvedModel?.id || model || "default";
	const queuedMsgs = messages.filter((m) => m.queued);
	const isWelcome = messages.length === 1 && messages[0].id === WELCOME_MESSAGE.id;

	return (
		<box flexDirection="column" height={"100%"} backgroundColor={colors.background}>
			<Toast toast={toast} />
			{showDashboard ? (
				<scrollbox flexGrow={1} scrollY stickyScroll stickyStart="bottom" focused={false}>
					<TeamDashboard
						members={members}
						tasks={client.listTasks()}
						goals={goals}
						teamMd={teamMd}
						teamSummaries={teamSummaries}
						activeMemberName={activeMemberName}
						isWelcome={isWelcome}
						currentSessionId={client.getSessionId()}
						cursorSection={dashboardSection}
						cursorIndex={dashboardCursor}
						onSelectMember={(name) => setActiveMemberName(name)}
						onSelectTeam={(sessionId) => {
							client.switchSession(`sqlite://${sessionId}`).catch(() => {});
						}}
						onClose={() => setShowDashboard(false)}
					/>
				</scrollbox>
			) : isWelcome ? (
				<scrollbox flexGrow={1} scrollY stickyScroll stickyStart="bottom" focused={false}>
					<WelcomeBanner cwd={cwd} model={modelDisplay} />
				</scrollbox>
			) : (
				<MessageList
					messages={displayMessages.filter((m) => !m.queued)}
					scrollRef={scrollRef}
					thinkingCollapsed={thinkingCollapsed}
				/>
			)}
			{(members.length > 0 || btwTask) && (
				<TeamTopology
					members={members}
					tasks={client.listTasks()}
					activeMemberName={activeMemberName}
					btwBackgroundTask={
						btwTask ? { status: btwTask.status, taskSummary: btwTask.taskSummary } : null
					}
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
					onClose={() => {
						setShowSettings(false);
						setConfigState(readConfig(cwd));
					}}
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
			{showWorkers && <WorkersView client={client} onClose={() => setShowWorkers(false)} />}
			<box flexDirection="column" flexShrink={0} paddingLeft={1} paddingRight={1}>
				{pendingQuestion && bridge ? (
					<QuestionBox
						questionData={pendingQuestion}
						onSubmit={(answers) => {
							bridge.resolve?.(answers);
							setPendingQuestion(null);
						}}
						onCancel={() => {
							bridge.resolve?.([]);
							setPendingQuestion(null);
						}}
					/>
				) : (
					<InputBox
						disabled={isRunning}
						mode={showSettings || picker.showSessionPicker ? "normal" : mode}
						agentMode={agentMode === "standard" ? getBaseMode(configState) : agentMode}
						model={modelDisplay}
						cwd={cwd}
						pollManager={pollManagerRef.current}
						skills={client.listSkills().skills}
						onSubmit={handlePrompt}
						sentMessages={commandHistory}
						pendingInput={pendingInput}
						members={members}
						activeMemberName={activeMemberName}
					/>
				)}
				<StatusBar
					mode={mode}
					contextPercent={contextUsage.percent}
					contextTokens={contextUsage.tokens}
					contextWindow={contextUsage.window}
					copyFeedback={copyFeedback}
					onCopyFeedbackClear={() => setCopyFeedback(null)}
				/>
			</box>
		</box>
	);
}
