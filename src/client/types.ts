import type { AuthStorage, ModelRegistry, SettingsManager } from "@earendil-works/pi-coding-agent";
import type { AgentSession, AgentSessionEvent } from "../agent/session.js";
import type { CommandContext } from "../commands/registry.js";
import type { Message } from "../message.js";
import type { SessionInfo } from "../session/list.js";
import type { MemberName, MemberState, TaskState, TeamEvent } from "../teams/types-v2.js";

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

	getMappedMessages(): Message[];

	cycleModel(): Promise<CycleModelResult | undefined>;
	setActiveToolsByName(tools: string[]): void;
	setAgentMode(mode: AgentMode): void;

	listSessions(): Promise<SessionInfo[]>;

	subscribe(handler: EventHandler): Unsubscribe;

	onSessionChange(handler: (session: AgentSession) => Promise<void>): void;

	getSettingsManager(): SettingsManager;
	getModelRegistry(): ModelRegistry;
	getAuthStorage(): AuthStorage;
	getSkillManager(): import("../skills/manager.js").SkillManager;
	getSession(): AgentSession;
	getRuntime(): import("../agent/session.js").AgentSessionRuntime;

	executeCommand(name: string, args: string, ctx: CommandContext): Promise<boolean>;

	subscribeTeam(handler: (event: TeamEvent) => void): Unsubscribe;

	createMember(opts: {
		name: MemberName;
		role: string;
		goal: string;
		model?: string;
	}): Promise<MemberState>;
	removeMember(name: MemberName): Promise<void>;
	getMember(name: MemberName): MemberState | undefined;
	listMembers(): MemberState[];

	assignTask(opts: {
		title: string;
		description: string;
		memberName: MemberName;
		priority?: "high" | "medium" | "low";
	}): Promise<TaskState>;
	listTasks(): TaskState[];
	taskStatus(taskId: string): TaskState | undefined;
}
