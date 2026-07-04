import type { AuthStorage, ModelRegistry, SettingsManager } from "@earendil-works/pi-coding-agent";
import type { AgentSession, AgentSessionEvent } from "../agent/session.js";
import type { CommandContext } from "../commands/registry.js";
import type { Message } from "../message.js";
import type { SessionInfo } from "../session/list.js";
import type {
	AgentClientEvent,
	MemberId,
	TeamMember,
	TeamMessage,
	TeamTask,
	WorkerId,
	WorkerSnapshot,
	WorkerStatus,
} from "../teams/types.js";

export type AgentMode = "standard" | "planner" | "orchestrator" | "team";

export type Unsubscribe = () => void;
export type EventHandler = (event: AgentSessionEvent) => void;

export interface ContextUsage {
	tokens?: number | null;
	contextWindow?: number | null;
	percent?: number | null;
}

export interface ModelInfo {
	name?: string;
	id?: string;
}

export interface CycleModelResult {
	model: {
		name: string;
		id: string;
	};
}

export interface NewSessionResult {
	cancelled: boolean;
}

/**
 * AgentClient — the interface TUI uses to interact with the agent engine.
 * TUI components MUST depend on this interface, not on AgentSessionRuntime
 * or AgentSession directly. In Phase 0 this is a thin facade over the runtime;
 * Phase 1+ replaces the backing with AgentServer.
 */
export interface AgentClient {
	prompt(text: string): Promise<void>;
	followUp(text: string): Promise<void>;
	abort(): Promise<void>;
	compact(instructions?: string): Promise<unknown>;

	newSession(): Promise<NewSessionResult>;
	switchSession(path: string): Promise<NewSessionResult>;
	setSessionName(name: string): void;
	getSessionName(): string | undefined;

	getSessionId(): string;
	getSessionFile(): string | undefined;
	getModel(): ModelInfo | undefined;
	getContextUsage(): ContextUsage | undefined;

	/**
	 * Returns SDK messages converted to TUI Message[] format.
	 * Encapsulates mapSdkMessagesToTui so TUI never imports session/render.js.
	 */
	getMappedMessages(): Message[];

	cycleModel(): Promise<CycleModelResult | undefined>;
	setActiveToolsByName(tools: string[]): void;
	setAgentMode(mode: AgentMode): void;

	listSessions(): Promise<SessionInfo[]>;

	/**
	 * Subscribe to agent events. Stays valid across session hot-switches —
	 * the client re-subscribes internally when the session changes.
	 */
	subscribe(handler: EventHandler): Unsubscribe;

	onSessionChange(handler: (session: AgentSession) => Promise<void>): void;

	/** @internal Phase 0 compat — Phase 1 will abstract away */
	getSettingsManager(): SettingsManager;
	/** @internal Phase 0 compat — Phase 1 will abstract away */
	getModelRegistry(): ModelRegistry;
	/** @internal Phase 0 compat — Phase 1 will abstract away */
	getAuthStorage(): AuthStorage;
	/** @internal Phase 0 compat — Phase 1 will abstract away */
	getSkillManager(): import("../skills/manager.js").SkillManager;
	/** @internal Phase 0 compat — Phase 1 will remove */
	getSession(): AgentSession;
	/** @internal Phase 0 compat — Phase 1 will remove */
	getRuntime(): import("../agent/session.js").AgentSessionRuntime;

	executeCommand(name: string, args: string, ctx: CommandContext): Promise<boolean>;

	// V1 Worker methods — deprecated, use V2 member methods
	/** @deprecated Use createMember() + assignTask() */
	listWorkers(): WorkerSnapshot[];
	/** @deprecated Use getMember() */
	getWorker(id: WorkerId): WorkerSnapshot | undefined;
	/** @deprecated Use createMember() + assignTask() */
	spawnWorker(agent: string, task: string): Promise<{ workerId: WorkerId; status: WorkerStatus }>;
	/** @deprecated Use cancelMember() */
	cancelWorker(workerId: WorkerId): Promise<void>;
	/** @deprecated Use cancelAllMembers() */
	cancelAllWorkers(): Promise<void>;
	subscribeTeam(handler: (event: AgentClientEvent) => void): Unsubscribe;

	// V2 Team methods
	createMember(opts: {
		name: string;
		role: string;
		goal: string;
		model?: string;
		tools?: string[];
		systemPrompt?: string;
	}): Promise<TeamMember>;
	removeMember(id: MemberId): Promise<void>;
	getMember(id: MemberId): TeamMember | undefined;
	listMembers(): TeamMember[];

	assignTask(opts: {
		title: string;
		description: string;
		memberId: MemberId;
		priority?: "high" | "medium" | "low";
	}): Promise<TeamTask>;
	listTasks(): TeamTask[];
	taskStatus(taskId: string): TeamTask | undefined;

	sendMessage(from: MemberId, to: MemberId | "team", content: string): Promise<void>;
	readInbox(memberId?: MemberId): TeamMessage[];
}
