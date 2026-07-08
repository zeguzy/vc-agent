import { join } from "node:path";
import type { AgentSession, AgentSessionEvent, AgentSessionRuntime } from "../agent/session.js";
import { activeToolsFor } from "../agent/session.js";
import type {
	AgentMode,
	ContextUsage,
	CycleModelResult,
	EventHandler,
	ModelInfo,
	NewSessionResult,
	Unsubscribe,
} from "../client/types.js";
import type { CommandContext } from "../commands/registry.js";
import { commandRegistry } from "../commands/registry.js";
import { readConfig, resolveConfigTeams } from "../config.js";
import { ORCHESTRATOR_SYSTEM_PROMPT, TEAM_ORCHESTRATOR_PROMPT } from "../context-files.js";
import type { McpManager } from "../mcp/manager.js";
import { NotificationRouter, setGlobalRouter } from "../notifications/notifier.js";
import { listSessions } from "../session/list.js";
import { mapSdkMessagesToTui } from "../session/render.js";
import type { SkillManager } from "../skills/manager.js";
import { TeamManager } from "../teams/manager-v2.js";
import type {
	MemberName,
	MemberState,
	TaskState,
	TaskType,
	TeamEvent,
	TeamManagerRef,
} from "../teams/types-v2.js";
import { parseSessionIdFromUri, teamDirForSession } from "../utils/paths.js";

export interface AgentServerOptions {
	runtime: AgentSessionRuntime;
	skillManager: SkillManager;
	mcpManager: McpManager;
	cwd: string;
	teamRef?: TeamManagerRef;
}

export class AgentServer {
	private readonly runtime: AgentSessionRuntime;
	private readonly skillManager: SkillManager;
	private readonly mcpManager: McpManager;
	private readonly cwd: string;
	private readonly eventHandlers = new Set<EventHandler>();
	private readonly teamEventHandlers = new Set<(event: TeamEvent) => void>();
	private readonly sessionChangeHandlers = new Set<(session: AgentSession) => Promise<void>>();
	private currentUnsub: Unsubscribe | null = null;
	private readonly notificationRouter: NotificationRouter;
	teamManager: TeamManager;
	readonly teamRef: TeamManagerRef;
	private readonly teamConfig: ReturnType<typeof resolveConfigTeams>;
	private teamUnsub: (() => void) | null = null;

	constructor(opts: AgentServerOptions) {
		this.runtime = opts.runtime;
		this.skillManager = opts.skillManager;
		this.mcpManager = opts.mcpManager;
		this.cwd = opts.cwd;

		this.notificationRouter = new NotificationRouter({
			config: readConfig(opts.cwd).notifications,
		});
		setGlobalRouter(this.notificationRouter);

		const config = readConfig(opts.cwd);
		this.teamConfig = resolveConfigTeams(config);
		this.teamManager = new TeamManager(
			this.teamConfig,
			this.runtime.services,
			this.cwd,
			this.sessionTeamDir(),
			undefined,
			this.session.model,
			this.skillManager,
			this.mcpManager,
		);
		if (opts.teamRef) {
			opts.teamRef.current = this.teamManager;
		}
		this.teamRef = opts.teamRef ?? { current: this.teamManager };

		this.runtime.setRebindSession(async (newSession) => {
			if (this.teamConfig.cancelOrphansOnSessionChange) {
				await this.disposeTeam();
				this.teamManager = new TeamManager(
					this.teamConfig,
					this.runtime.services,
					this.cwd,
					this.sessionTeamDir(),
					undefined,
					this.session.model,
					this.skillManager,
					this.mcpManager,
				);
				this.teamRef.current = this.teamManager;
			}
			this.resubscribe();
			if (this.teamConfig.cancelOrphansOnSessionChange) {
				await this.teamManager.restoreMembers({
					services: this.runtime.services,
					parentModel: this.session.model,
				});
			}
			for (const handler of this.sessionChangeHandlers) {
				await handler(newSession);
			}
		});

		this.ensureSubscribed();

		const dispose = () => {
			void this.disposeTeam();
			void this.mcpManager.dispose();
		};
		process.once("exit", dispose);
		process.once("SIGINT", () => {
			dispose();
			process.exit(0);
		});
		process.once("SIGTERM", () => {
			dispose();
			process.exit(0);
		});
	}

	private get session(): AgentSession {
		return this.runtime.session;
	}

	private sessionTeamDir(): string {
		const sf = this.session.sessionFile;
		if (sf) {
			const sessionId = parseSessionIdFromUri(sf);
			return teamDirForSession(sessionId);
		}
		return join(this.cwd, ".openagent", "team");
	}

	private broadcastTeamEvent(event: TeamEvent) {
		for (const handler of this.teamEventHandlers) {
			try {
				handler(event);
			} catch (err) {
				console.error(`[teams] event handler threw: ${err}`);
			}
		}
	}

	handleSubscribeTeam(handler: (event: TeamEvent) => void): Unsubscribe {
		this.teamEventHandlers.add(handler);
		return () => {
			this.teamEventHandlers.delete(handler);
		};
	}

	private async disposeTeam() {
		if (this.teamUnsub) {
			this.teamUnsub();
			this.teamUnsub = null;
		}
		await this.teamManager.dispose();
	}

	private ensureSubscribed() {
		if (this.currentUnsub) return;
		this.currentUnsub = this.session.subscribe((event: AgentSessionEvent) => {
			this.notificationRouter.handleEvent(event);
			for (const handler of this.eventHandlers) {
				handler(event);
			}
		});
		if (!this.teamUnsub) {
			this.teamUnsub = this.teamManager.subscribe((event: TeamEvent) => {
				this.broadcastTeamEvent(event);

				if (event.type === "member_done") {
					const state = this.teamManager.getMember(event.memberName);
					if (state) {
						const costStr = event.cost > 0 ? ` | cost $${event.cost.toFixed(4)}` : "";
						const task = state.currentTaskId
							? this.teamManager.listTasks().find((t) => t.id === state.currentTaskId)
							: undefined;
						const taskTitle = task?.title ? ` — ${task.title}` : "";
						const note = `[Team Member ${event.memberName}${taskTitle} ${state.status}${costStr}]\n${event.summary}`;
						if (this.session.isStreaming) {
							this.session.steer(note);
						} else {
							void this.session.prompt(note);
						}
					}
				}

				if (event.type === "member_error") {
					const note = `[Team Member ${event.memberName} error]\n${event.error}`;
					if (this.session.isStreaming) {
						this.session.steer(note);
					} else {
						void this.session.prompt(note);
					}
				}
			});
		}
	}

	private resubscribe() {
		if (this.currentUnsub) {
			this.currentUnsub();
			this.currentUnsub = null;
		}
		this.ensureSubscribed();
	}

	handlePrompt(text: string): Promise<void> {
		return this.session.prompt(text);
	}

	handleFollowUp(text: string): Promise<void> {
		return this.session.followUp(text);
	}

	handleAbort(): Promise<void> {
		return this.session.abort();
	}

	handleCompact(instructions?: string): Promise<unknown> {
		return this.session.compact(instructions);
	}

	handleNewSession(): Promise<NewSessionResult> {
		return this.runtime.newSession();
	}

	handleSwitchSession(path: string): Promise<NewSessionResult> {
		return this.runtime.switchSession(path);
	}

	handleSetSessionName(name: string): void {
		this.session.setSessionName(name);
	}

	handleGetSessionName(): string | undefined {
		return this.session.sessionName;
	}

	handleGetSessionId(): string {
		return this.session.sessionId;
	}

	handleGetSessionFile(): string | undefined {
		return this.session.sessionFile;
	}

	handleGetModel(): ModelInfo | undefined {
		const model = this.session.model;
		return model ? { name: model.name, id: model.id } : undefined;
	}

	handleGetContextUsage(): ContextUsage | undefined {
		return this.session.getContextUsage();
	}

	handleGetMappedMessages() {
		return mapSdkMessagesToTui(this.session.messages);
	}

	handleCycleModel(): Promise<CycleModelResult | undefined> {
		return this.session.cycleModel();
	}

	handleSetActiveToolsByName(tools: string[]): void {
		this.session.setActiveToolsByName(tools);
	}

	handleSetAgentMode(mode: AgentMode): void {
		const hasMcp = this.mcpManager.getToolDefinitions().length > 0;
		this.session.setActiveToolsByName([...activeToolsFor(mode), ...(hasMcp ? ["mcp"] : [])]);
		if (mode === "orchestrator") {
			this.session.steer(ORCHESTRATOR_SYSTEM_PROMPT);
		}
		if ((mode === "orchestrator" || mode === "team") && this.teamConfig.enabled) {
			this.session.steer(TEAM_ORCHESTRATOR_PROMPT);
		}
	}

	async handleListSessions(): Promise<import("../session/list.js").SessionInfo[]> {
		return listSessions(this.cwd);
	}

	handleSubscribe(handler: EventHandler): Unsubscribe {
		this.eventHandlers.add(handler);
		return () => {
			this.eventHandlers.delete(handler);
		};
	}

	handleOnSessionChange(handler: (session: AgentSession) => Promise<void>): void {
		this.sessionChangeHandlers.add(handler);
	}

	handleGetSettingsManager() {
		return this.session.settingsManager;
	}

	handleGetModelRegistry() {
		return this.session.modelRegistry;
	}

	handleGetAuthStorage() {
		return this.session.modelRegistry.authStorage;
	}

	handleGetSkillManager(): SkillManager {
		return this.skillManager;
	}

	handleGetSession(): AgentSession {
		return this.runtime.session;
	}

	handleGetRuntime(): AgentSessionRuntime {
		return this.runtime;
	}

	handleExecuteCommand(name: string, args: string, ctx: CommandContext): Promise<boolean> {
		return commandRegistry.execute(name, args, ctx);
	}

	handleListMembers(): MemberState[] {
		return this.teamManager.listMembers();
	}

	handleGetMember(name: MemberName): MemberState | undefined {
		return this.teamManager.getMember(name);
	}

	async handleCreateMember(opts: {
		name: MemberName;
		role: string;
		goal: string;
		constraints?: string;
		model?: string;
		tools?: string[];
		skills?: string[];
		mcps?: string[];
	}): Promise<MemberState> {
		return this.teamManager.createMember({
			...opts,
			services: this.runtime.services,
			parentModel: this.session.model,
		});
	}

	async handleRemoveMember(name: MemberName): Promise<void> {
		return this.teamManager.removeMember(name);
	}

	async handleAssignTask(opts: {
		title: string;
		description: string;
		memberName: MemberName;
		priority?: "high" | "medium" | "low";
		type?: TaskType;
	}): Promise<TaskState> {
		return this.teamManager.assignTask(opts);
	}

	handleListTasks(): TaskState[] {
		return this.teamManager.listTasks();
	}

	handleTaskStatus(taskId: string): TaskState | undefined {
		const tasks = this.teamManager.listTasks();
		return tasks.find((t) => t.id === taskId);
	}

	handlePauseMember(name: MemberName): void {
		this.teamManager.pauseMember(name);
	}

	handleResumeMember(name: MemberName): void {
		this.teamManager.resumeMember(name);
	}

	handleCancelMember(name: MemberName): void {
		this.teamManager.cancelMember(name);
	}

	handleDirectMember(
		name: MemberName,
		kind: "directive" | "context" | "redirect",
		payload: string,
	): void {
		this.teamManager.directMember(name, kind, payload);
	}

	handleSendMessage(opts: { from: MemberName; to: MemberName; content: string }): {
		message: import("../teams/types-v2.js").MemberMessage;
		delivery: import("../teams/types-v2.js").DeliveryMode;
	} {
		return this.teamManager.sendMessage(opts);
	}

	handleBroadcastMessage(opts: { from: MemberName; content: string }): Array<{
		message: import("../teams/types-v2.js").MemberMessage;
		delivery: import("../teams/types-v2.js").DeliveryMode;
	}> {
		return this.teamManager.broadcastMessage(opts);
	}

	handleReadInbox(
		name: MemberName,
		opts?: { from?: MemberName; unreadOnly?: boolean; limit?: number },
	): import("../teams/types-v2.js").MemberMessage[] {
		return this.teamManager.readInbox(name, opts);
	}

	handleMarkInboxRead(name: MemberName, ids?: string[]): number {
		return this.teamManager.markInboxRead(name, ids);
	}
}

export function createServer(opts: AgentServerOptions): AgentServer {
	return new AgentServer(opts);
}
