import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentSession, AgentSessionEvent, AgentSessionRuntime } from "../agent/session.js";
import { activeToolsFor } from "../agent/session.js";
import type {
	AgentMode,
	ContextUsage,
	CycleModelResult,
	EventHandler,
	ExtendedModelInfo,
	LoadSkillResult,
	ModelInfo,
	NavigateResult,
	NewSessionResult,
	SkillDirectories,
	SkillListResult,
	TeamSummary,
	Unsubscribe,
	UserMessageSummary,
} from "../client/types.js";
import type { CommandContext } from "../commands/registry.js";
import { commandRegistry } from "../commands/registry.js";
import { readConfig, resolveConfigTeams } from "../config.js";
import { ORCHESTRATOR_SYSTEM_PROMPT, TEAM_ORCHESTRATOR_PROMPT } from "../context-files.js";
import { getDcpConfig, isDcpEnabled } from "../dcp/config.js";
import type { McpManager } from "../mcp/manager.js";
import { NotificationRouter, setGlobalRouter } from "../notifications/notifier.js";
import {
	type BtwEnterResult,
	type BtwState,
	createBackgroundMonitor,
	injectNotification,
} from "../session/btw.js";
import { listSessions } from "../session/list.js";
import { mapSdkMessagesToTui } from "../session/render.js";
import { getSdkInternals } from "../session/sdk-internals.js";
import type { SkillManager } from "../skills/manager.js";
import { parseTeamMd } from "../teams/files.js";
import { TeamManager } from "../teams/manager-v2.js";
import type {
	GoalStatus,
	MemberName,
	MemberState,
	TaskState,
	TaskType,
	TeamEvent,
	TeamManagerRef,
	TeamMdStructure,
} from "../teams/types-v2.js";
import {
	buildSqliteUri,
	parseSessionIdFromUri,
	teamDir,
	teamDirForSession,
} from "../utils/paths.js";

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
	private readonly sessionChangeHandlers = new Set<(sessionId: string) => Promise<void>>();
	private currentUnsub: Unsubscribe | null = null;
	private readonly notificationRouter: NotificationRouter;
	teamManager: TeamManager;
	readonly teamRef: TeamManagerRef;
	private readonly teamConfig: ReturnType<typeof resolveConfigTeams>;
	private teamUnsub: (() => void) | null = null;
	private btwState: BtwState | null = null;
	/** When true, setRebindSession skips team disposal (btw session switch). */
	private preserveBackground = false;

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
			const shouldPreserveTeam = this.preserveBackground;
			if (this.teamConfig.cancelOrphansOnSessionChange && !shouldPreserveTeam) {
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
			if (this.teamConfig.cancelOrphansOnSessionChange && !shouldPreserveTeam) {
				await this.teamManager.restoreMembers({
					services: this.runtime.services,
					parentModel: this.session.model,
				});
			}
			for (const handler of this.sessionChangeHandlers) {
				await handler(newSession.sessionId);
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
		// Always use per-session directory to isolate members across sessions.
		// sessionFile may be undefined (e.g. in-memory sessions), but sessionId
		// is always available. Prefer sessionFile's parsed ID for consistency
		// with session storage paths; fall back to sessionId directly.
		const sf = this.session.sessionFile;
		const sessionId = sf ? parseSessionIdFromUri(sf) : this.session.sessionId;
		return teamDirForSession(sessionId);
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
						const body = `[Team Member ${event.memberName}${taskTitle} ${state.status}${costStr}]\n${event.summary}`;
						injectNotification(this.session, body);
					}
				}

				if (event.type === "member_error") {
					const note = `[Team Member ${event.memberName} error]\n${event.error}`;
					injectNotification(this.session, note);
				}

				if (event.type === "task_completed" && event.conclusion) {
					const task = this.teamManager.listTasks().find((t) => t.id === event.taskId);
					const title = task?.title ?? event.taskId;
					const body = `[Discussion "${title}" completed]\nConclusion: ${event.conclusion}`;
					injectNotification(this.session, body);
				}

				if (event.type === "wait_completed") {
					injectNotification(
						this.session,
						`[Wait timer expired]\nUse team(action="read") to check the latest team status.`,
					);
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
		const dcpOn = isDcpEnabled(getDcpConfig());
		this.session.setActiveToolsByName([
			...activeToolsFor(mode),
			...(hasMcp ? ["mcp"] : []),
			...(dcpOn ? ["compress"] : []),
		]);
		if (mode === "orchestrator") {
			this.session.steer(ORCHESTRATOR_SYSTEM_PROMPT);
		}
		if (mode === "team" && this.teamConfig.enabled) {
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

	handleOnSessionChange(handler: (sessionId: string) => Promise<void>): void {
		this.sessionChangeHandlers.add(handler);
	}

	handleSetModel(provider: string, id: string): Promise<void> {
		const model = this.session.modelRegistry.find(provider, id);
		if (model) {
			return this.session.setModel(model);
		}
		return Promise.resolve();
	}

	handleGetAvailableThinkingLevels(): readonly string[] {
		return this.session.getAvailableThinkingLevels() as readonly string[];
	}

	handleSetThinkingLevel(level: string): void {
		this.session.setThinkingLevel(level as never);
	}

	handleGetUserMessagesForForking(): UserMessageSummary[] {
		return this.session.getUserMessagesForForking().map((m) => ({
			entryId: m.entryId,
			text: m.text,
		}));
	}

	handleGetEntryParentId(entryId: string): string | undefined {
		return this.session.sessionManager.getEntry(entryId)?.parentId ?? undefined;
	}

	async handleNavigateTree(parentId: string): Promise<NavigateResult> {
		const result = await this.session.navigateTree(parentId);
		return {
			cancelled: result.cancelled,
			...(result.editorText ? { lastUserText: result.editorText } : {}),
		};
	}

	async handleBtwEnter(): Promise<BtwEnterResult> {
		if (this.btwState) {
			throw new Error("Already in a side conversation. Use /btw back to return first.");
		}

		const bgSession = this.session;
		const bgSessionId = bgSession.sessionId;
		const returnPath = bgSession.sessionFile ?? buildSqliteUri(bgSessionId);

		const userMsgs = bgSession.getUserMessagesForForking();
		const lastUserText = userMsgs.length > 0 ? userMsgs[userMsgs.length - 1]?.text : "(no task)";
		const bgTaskSummary = lastUserText;

		const leafId = getSdkInternals(bgSession.sessionManager).leafId;
		if (!leafId) {
			throw new Error("Cannot fork: no current leaf entry in session.");
		}

		const bgUnsub = createBackgroundMonitor(bgSession, bgSession, () => {});

		try {
			this.preserveBackground = true;
			const branchedUri = bgSession.sessionManager.createBranchedSession(leafId);
			if (!branchedUri) {
				throw new Error("createBranchedSession returned undefined.");
			}
			const { cancelled } = await this.runtime.switchSession(branchedUri);

			this.btwState = { returnPath, bgSession, bgUnsub, bgTaskSummary };

			return { backgroundSessionId: bgSessionId, cancelled };
		} catch (err) {
			this.preserveBackground = false;
			bgUnsub();
			throw err;
		}
	}

	async handleBtwBack(): Promise<void> {
		if (!this.btwState) {
			throw new Error("Not in a side conversation. Use /btw to start one.");
		}

		const { returnPath, bgUnsub } = this.btwState;
		bgUnsub();
		this.btwState = null;

		this.preserveBackground = true;
		try {
			await this.runtime.switchSession(returnPath);
		} finally {
			this.preserveBackground = false;
		}
	}

	handleBtwStatus(): { active: boolean; backgroundSessionId?: string; taskSummary?: string } {
		if (!this.btwState) return { active: false };
		return {
			active: true,
			backgroundSessionId: this.btwState.bgSession.sessionId,
			taskSummary: this.btwState.bgTaskSummary,
		};
	}

	handleListSkills(): SkillListResult {
		const result = this.skillManager.listSkills();
		return {
			skills: result.skills.map((s) => ({
				name: s.name,
				description: s.description,
				source: s.source,
				disableModelInvocation: s.disableModelInvocation,
				...(s.filePath ? { filePath: s.filePath } : {}),
			})),
			diagnostics: result.diagnostics.map((d) => ({ message: d.message })),
		};
	}

	handleGetSkillDirectories(): SkillDirectories {
		return this.skillManager.getDefaultDirectories();
	}

	async handleLoadDynamicSkill(path: string): Promise<LoadSkillResult> {
		const { resolve } = await import("node:path");
		const { sep } = await import("node:path");
		const resolved = resolve(path);
		const dirs = this.skillManager.getDefaultDirectories();
		const allowed = [dirs.global, dirs.project].map((d) => resolve(d));
		if (!allowed.some((d) => resolved.startsWith(d + sep))) {
			throw new Error(`Skill path outside allowed directories: ${path}`);
		}
		const result = await this.skillManager.loadDynamicSkill(path);
		const skill = result.skill;
		return {
			name: skill.name,
			description: skill.description,
			filePath: skill.filePath,
			disableModelInvocation: skill.disableModelInvocation,
		};
	}

	async handleUnloadDynamicSkill(name: string): Promise<boolean> {
		return this.skillManager.unloadDynamicSkill(name);
	}

	handleSetCompactionEnabled(enabled: boolean): void {
		this.session.settingsManager.setCompactionEnabled(enabled);
	}

	handleListModels(): ExtendedModelInfo[] {
		return this.session.modelRegistry.getAll().map((m) => ({
			id: m.id,
			name: m.name,
			provider: m.provider,
			reasoning: m.reasoning,
			input: m.input,
		}));
	}

	handleFindModel(provider: string, id: string): ExtendedModelInfo | undefined {
		const m = this.session.modelRegistry.find(provider, id);
		if (!m) return undefined;
		return {
			id: m.id,
			name: m.name,
			provider: m.provider,
			reasoning: m.reasoning,
			input: m.input,
		};
	}

	handleHasAuthProvider(provider: string): boolean {
		return this.session.modelRegistry.authStorage.hasAuth(provider);
	}

	handleSetRuntimeApiKey(provider: string, key: string): void {
		this.session.modelRegistry.authStorage.setRuntimeApiKey(provider, key);
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

	async handleStartDiscussion(opts: {
		title: string;
		description: string;
		participants: MemberName[];
		priority?: "high" | "medium" | "low";
	}): Promise<TaskState> {
		return this.teamManager.startDiscussion(opts);
	}

	handleCompleteTask(taskId: string): void {
		this.teamManager.completeTask(taskId);
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

	handleListGoals(filter?: { status?: GoalStatus }): import("../teams/types-v2.js").Goal[] {
		return this.teamManager.listGoals(filter);
	}

	handleReadTeamMd(): TeamMdStructure {
		return this.teamManager.readTeamMd();
	}

	handleListTeamSummaries(): TeamSummary[] {
		const teamRoot = teamDir();
		if (!existsSync(teamRoot)) return [];
		const entries = readdirSync(teamRoot, { withFileTypes: true });
		const summaries: TeamSummary[] = [];
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			const sessionId = entry.name;
			const teamMdPath = join(teamRoot, sessionId, "TEAM.md");
			if (!existsSync(teamMdPath)) continue;
			try {
				const raw = readFileSync(teamMdPath, "utf-8");
				const parsed = parseTeamMd(raw);
				const memberCount = parsed.members.length;
				const activeCount = parsed.members.filter((m) => m.status === "active").length;
				if (memberCount === 0 && parsed.goals.length === 0 && parsed.activeTasks.length === 0)
					continue;
				summaries.push({
					sessionId,
					sessionName: null,
					mission: parsed.mission,
					memberCount,
					activeCount,
					goalCount: parsed.goals.length,
					taskCount: parsed.activeTasks.length,
				});
			} catch {
				// Skip unreadable TEAM.md
			}
		}
		return summaries;
	}
}

export function createServer(opts: AgentServerOptions): AgentServer {
	return new AgentServer(opts);
}
