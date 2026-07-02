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
import { readConfig } from "../config.js";
import { ORCHESTRATOR_SYSTEM_PROMPT } from "../context-files.js";
import { NotificationRouter, setGlobalRouter } from "../notifications/notifier.js";
import { listSessions } from "../session/list.js";
import { mapSdkMessagesToTui } from "../session/render.js";
import type { SkillManager } from "../skills/manager.js";

export interface AgentServerOptions {
	runtime: AgentSessionRuntime;
	skillManager: SkillManager;
	cwd: string;
}

export class AgentServer {
	private readonly runtime: AgentSessionRuntime;
	private readonly skillManager: SkillManager;
	private readonly cwd: string;
	private readonly eventHandlers = new Set<EventHandler>();
	private readonly sessionChangeHandlers = new Set<(session: AgentSession) => Promise<void>>();
	private currentUnsub: Unsubscribe | null = null;
	private readonly notificationRouter: NotificationRouter;

	constructor(opts: AgentServerOptions) {
		this.runtime = opts.runtime;
		this.skillManager = opts.skillManager;
		this.cwd = opts.cwd;

		this.notificationRouter = new NotificationRouter({
			config: readConfig(opts.cwd).notifications,
		});
		setGlobalRouter(this.notificationRouter);

		this.runtime.setRebindSession(async (newSession) => {
			this.resubscribe();
			for (const handler of this.sessionChangeHandlers) {
				await handler(newSession);
			}
		});

		this.ensureSubscribed();
	}

	private get session(): AgentSession {
		return this.runtime.session;
	}

	private ensureSubscribed() {
		if (this.currentUnsub) return;
		this.currentUnsub = this.session.subscribe((event: AgentSessionEvent) => {
			this.notificationRouter.handleEvent(event);
			for (const handler of this.eventHandlers) {
				handler(event);
			}
		});
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
}

export function createServer(opts: AgentServerOptions): AgentServer {
	return new AgentServer(opts);
}
