import type { AgentSessionEvent } from "../agent/session.js";
import type { CommandContext } from "../commands/registry.js";
import type { Message } from "../message.js";
import type { SessionInfo } from "../session/list.js";
import type {
	DeliveryMode,
	MemberMessage,
	MemberName,
	MemberState,
	ReadInboxOptions,
	TaskState,
	TaskType,
	TeamEvent,
} from "../teams/types-v2.js";

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

export interface UserMessageSummary {
	entryId: string;
	text: string;
}

export interface NavigateResult {
	cancelled: boolean;
	lastUserText?: string;
}

export interface SkillListEntry {
	name: string;
	description: string;
	source: "auto" | "dynamic";
	disableModelInvocation: boolean;
	filePath?: string;
}

export interface SkillListResult {
	skills: SkillListEntry[];
	diagnostics: Array<{ message: string }>;
}

export interface SkillDirectories {
	global: string;
	project: string;
}

export interface LoadSkillResult {
	name: string;
	description: string;
	filePath: string;
	disableModelInvocation: boolean;
}

export interface ExtendedModelInfo extends ModelInfo {
	id: string;
	name: string;
	provider: string;
	reasoning?: boolean;
	input?: string[];
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

	onSessionChange(handler: (sessionId: string) => Promise<void>): void;

	setModel(provider: string, id: string): Promise<void>;
	getAvailableThinkingLevels(): readonly string[];
	setThinkingLevel(level: string): void;
	getUserMessagesForForking(): UserMessageSummary[];
	getEntryParentId(entryId: string): string | undefined;
	navigateTree(parentId: string): Promise<NavigateResult>;

	listSkills(): SkillListResult;
	getSkillDirectories(): SkillDirectories;
	loadDynamicSkill(path: string): Promise<LoadSkillResult>;
	unloadDynamicSkill(name: string): Promise<boolean>;

	setCompactionEnabled(enabled: boolean): void;

	listModels(): ExtendedModelInfo[];
	findModel(provider: string, id: string): ExtendedModelInfo | undefined;

	hasAuthProvider(provider: string): boolean;
	setRuntimeApiKey(provider: string, key: string): void;

	executeCommand(name: string, args: string, ctx: CommandContext): Promise<boolean>;

	subscribeTeam(handler: (event: TeamEvent) => void): Unsubscribe;

	createMember(opts: {
		name: MemberName;
		role: string;
		goal: string;
		/** Optional role-specific constraints; injected into member's Anti-Patterns. */
		constraints?: string;
		model?: string;
		tools?: string[];
		skills?: string[];
		mcps?: string[];
	}): Promise<MemberState>;
	removeMember(name: MemberName): Promise<void>;
	getMember(name: MemberName): MemberState | undefined;
	listMembers(): MemberState[];

	assignTask(opts: {
		title: string;
		description: string;
		memberName: MemberName;
		priority?: "high" | "medium" | "low";
		type?: TaskType;
	}): Promise<TaskState>;
	startDiscussion(opts: {
		title: string;
		description: string;
		participants: MemberName[];
		priority?: "high" | "medium" | "low";
	}): Promise<TaskState>;
	completeTask(taskId: string): void;
	listTasks(): TaskState[];
	taskStatus(taskId: string): TaskState | undefined;

	pauseMember(name: MemberName): void;
	resumeMember(name: MemberName): void;
	cancelMember(name: MemberName): void;
	directMember(name: MemberName, kind: "directive" | "context" | "redirect", payload: string): void;

	sendMessage(opts: {
		from: MemberName;
		to: MemberName;
		content: string;
	}): Promise<{ message: MemberMessage; delivery: DeliveryMode }>;
	broadcastMessage(opts: {
		from: MemberName;
		content: string;
	}): Promise<Array<{ message: MemberMessage; delivery: DeliveryMode }>>;
	readInbox(name: MemberName, opts?: ReadInboxOptions): MemberMessage[];
	markInboxRead(name: MemberName, ids?: string[]): number;
}
