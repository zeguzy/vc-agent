import type { AgentSession, AgentSessionEvent, AgentSessionRuntime } from "../agent/session.js";
import { activeToolsFor } from "../agent/session.js";
import { discoverAgents } from "../agents/discover.js";
import type { AgentConfig } from "../agents/types.js";
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
import { NotificationRouter, setGlobalRouter } from "../notifications/notifier.js";
import { listSessions } from "../session/list.js";
import { mapSdkMessagesToTui } from "../session/render.js";
import type { SkillManager } from "../skills/manager.js";
import { WorkerSessionPool } from "../teams/manager.js";
import type {
	AgentClientEvent,
	TeamOrphansCancelledEvent,
	WorkerEventEnvelope,
	WorkerId,
	WorkerPoolRef,
	WorkerSnapshot,
	WorkerStatus,
} from "../teams/types.js";

export interface AgentServerOptions {
	runtime: AgentSessionRuntime;
	skillManager: SkillManager;
	cwd: string;
	poolRef?: WorkerPoolRef;
}

export class AgentServer {
	private readonly runtime: AgentSessionRuntime;
	private readonly skillManager: SkillManager;
	private readonly cwd: string;
	private readonly eventHandlers = new Set<EventHandler>();
	private readonly teamEventHandlers = new Set<(event: AgentClientEvent) => void>();
	private readonly sessionChangeHandlers = new Set<(session: AgentSession) => Promise<void>>();
	private currentUnsub: Unsubscribe | null = null;
	private readonly notificationRouter: NotificationRouter;
	readonly workerPool: WorkerSessionPool;
	readonly poolRef: WorkerPoolRef;
	private readonly teamConfig: ReturnType<typeof resolveConfigTeams>;
	private workerPoolUnsub: (() => void) | null = null;

	constructor(opts: AgentServerOptions) {
		this.runtime = opts.runtime;
		this.skillManager = opts.skillManager;
		this.cwd = opts.cwd;

		this.notificationRouter = new NotificationRouter({
			config: readConfig(opts.cwd).notifications,
		});
		setGlobalRouter(this.notificationRouter);

		const config = readConfig(opts.cwd);
		this.teamConfig = resolveConfigTeams(config);
		this.workerPool = new WorkerSessionPool(this.teamConfig, this.runtime.services);
		if (opts.poolRef) {
			opts.poolRef.current = this.workerPool;
		}
		this.poolRef = opts.poolRef ?? { current: this.workerPool };

		this.runtime.setRebindSession(async (newSession) => {
			await this.cancelOrphans("session_change");
			this.resubscribe();
			for (const handler of this.sessionChangeHandlers) {
				await handler(newSession);
			}
		});

		this.ensureSubscribed();

		const dispose = () => {
			void this.workerPool.dispose();
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

	private broadcastTeamEvent(event: AgentClientEvent) {
		for (const handler of this.teamEventHandlers) {
			try {
				handler(event);
			} catch (err) {
				console.error(`[teams] event handler threw: ${err}`);
			}
		}
	}

	handleSubscribeTeam(handler: (event: AgentClientEvent) => void): Unsubscribe {
		this.teamEventHandlers.add(handler);
		return () => {
			this.teamEventHandlers.delete(handler);
		};
	}

	private async cancelOrphans(cause: "agent_end" | "session_change") {
		if (this.workerPool.runningCount() === 0) return;
		const ids = this.workerPool
			.list()
			.filter((w) => w.status === "running" || w.status === "idle")
			.map((w) => w.id);
		if (ids.length === 0) return;
		const enabled =
			cause === "agent_end"
				? this.teamConfig.cancelOrphansOnAgentEnd
				: this.teamConfig.cancelOrphansOnSessionChange;
		if (!enabled) return;
		await this.workerPool.cancelAll();
		const event: TeamOrphansCancelledEvent = {
			type: "team_orphans_cancelled",
			workerIds: ids,
			cause,
		};
		this.broadcastTeamEvent(event);
	}

	private ensureSubscribed() {
		if (this.currentUnsub) return;
		this.currentUnsub = this.session.subscribe((event: AgentSessionEvent) => {
			this.notificationRouter.handleEvent(event);
			for (const handler of this.eventHandlers) {
				handler(event);
			}
			if (event.type === "agent_end" && this.teamConfig.cancelOrphansOnAgentEnd) {
				void this.cancelOrphans("agent_end");
			}
		});
		if (!this.workerPoolUnsub) {
			this.workerPoolUnsub = this.workerPool.subscribe((event: WorkerEventEnvelope) => {
				this.broadcastTeamEvent(event);
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
		this.session.setActiveToolsByName(activeToolsFor(mode));
		if (mode === "orchestrator") {
			this.session.steer(ORCHESTRATOR_SYSTEM_PROMPT);
			if (this.teamConfig.enabled) {
				this.session.steer(TEAM_ORCHESTRATOR_PROMPT);
			}
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

	handleListWorkers(): WorkerSnapshot[] {
		return this.workerPool.list();
	}

	handleGetWorker(id: WorkerId): WorkerSnapshot | undefined {
		return this.workerPool.get(id);
	}

	async handleSpawnWorker(
		agent: string,
		task: string,
	): Promise<{ workerId: WorkerId; status: WorkerStatus }> {
		const { agents } = discoverAgents(this.cwd);
		const agentMap = new Map<string, AgentConfig>(agents.map((a) => [a.name, a]));
		const agentConfig = agentMap.get(agent);

		if (!agentConfig) {
			throw new Error(
				`agent "${agent}" not found. Available: ${agents.map((a) => a.name).join(", ") || "(none)"}`,
			);
		}

		if (agentConfig.background === false) {
			throw new Error(`agent "${agent}" has background:false — cannot be used as a team worker`);
		}

		return this.workerPool.spawnWorker({
			agent: agentConfig,
			task,
			cwd: this.cwd,
			services: this.runtime.services,
			parentModel: this.session.model,
		});
	}

	async handleCancelWorker(workerId: WorkerId): Promise<void> {
		await this.workerPool.cancel(workerId);
	}

	async handleCancelAllWorkers(): Promise<void> {
		await this.workerPool.cancelAll();
	}
}

export function createServer(opts: AgentServerOptions): AgentServer {
	return new AgentServer(opts);
}
