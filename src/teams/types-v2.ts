import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { SubagentServices } from "../agents/types.js";
import type { ResolvedModel } from "./types.js";

// ─── Memory Types ────────────────────────────────────────────

/** Four memory type taxonomy (inspired by Claude Code). */
export type MemoryType = "user" | "feedback" | "project" | "reference";

/** YAML frontmatter for topic .md files. */
export interface TopicFileFrontmatter {
	type: MemoryType;
	created: string; // ISO 8601
	updated: string; // ISO 8601
	tokens: number; // estimated
}

// ─── Member & Task State ────────────────────────────────────

/** Unique member identifier (kebab-case, e.g. "lysosome"). */
export type MemberName = string;

/** Member runtime state. */
export interface MemberState {
	name: MemberName;
	role: string;
	goal: string;
	model?: string;
	status: "active" | "idle" | "done" | "error" | "paused" | "cancelled";
	session: AgentSession;
	sessionId?: string;
	currentTaskId: string | null;
	lastTaskPrompt: string | null;
	assignedTools?: string[];
	assignedSkills?: string[];
	assignedMcps?: string[];
	/** Number of completed assistant turns (incremented on message_end). */
	turnCount: number;
	/** Cumulative input tokens across all turns. */
	inputTokens: number;
	/** Cumulative output tokens across all turns. */
	outputTokens: number;
	/** Cumulative cost in USD across all turns. */
	cost: number;
	/** Wall-clock timestamp (Date.now()) when member was created or restored. */
	startedAt: number;
}

/** Task type determines how the team manager handles completion. */
export type TaskType = "execution" | "discussion";

/** Task state derived from TEAM.md Active Tasks. */
export interface TaskState {
	id: string; // "T1", "T2", ...
	title: string;
	description: string;
	memberName: MemberName | null;
	priority: "high" | "medium" | "low";
	type: TaskType;
	done: boolean;
	participants?: MemberName[];
}

// ─── Parsed TEAM.md Structure ───────────────────────────────

export interface TeamMdStructure {
	mission: string;
	members: Array<{
		name: MemberName;
		role: string;
		status: string;
		currentTask: string;
		sessionId?: string;
	}>;
	activeTasks: TaskState[];
	importantNotes: string;
	sharedMemoryIndex: Array<{ path: string; description: string }>;
}

// ─── Member-to-Member Messaging ─────────────────────────────

/** Special "to" value for broadcasts. */
export const BROADCAST_RECIPIENT = "broadcast";

/** A single member-to-member message record. */
export interface MemberMessage {
	/** Unique id, format: `msg_<8char>`. */
	id: string;
	/** Sender member name, or `"leader"` when sender is the team leader. */
	from: MemberName;
	/** Recipient member name, or `"broadcast"` for fanout. */
	to: MemberName | typeof BROADCAST_RECIPIENT;
	content: string;
	/** Unix epoch ms. */
	timestamp: number;
	/** Whether the recipient has marked the message read. */
	read: boolean;
}

/** Options for reading a member inbox. */
export interface ReadInboxOptions {
	/** Filter by sender. */
	from?: MemberName;
	/** Only return unread messages. */
	unreadOnly?: boolean;
	/** Limit number of returned messages (default: 50). */
	limit?: number;
}

/** Result of delivering a message; surfaces whether it was steered in real-time. */
export type DeliveryMode = "steer" | "persist-only";

// ─── Parsed Member .md Structure ────────────────────────────

export interface MemberIndexStructure {
	profile: {
		role: string;
		goal: string;
		model?: string;
	};
	/**
	 * Role-specific behavioral constraints (leader-provided). Top-level, not in
	 * profile — persisted as `## Constraints` markdown section (multi-line free
	 * text), distinct from profile's single-line `- Key: value` metadata.
	 */
	constraints?: string;
	activeContext: string;
	memoryIndex: Array<{ file: string; type: MemoryType; description: string }>;
	recentActivity: Array<{ date: string; entry: string }>;
	assignedTools?: string[];
	assignedSkills?: string[];
	assignedMcps?: string[];
}

// ─── Team Directory Paths ───────────────────────────────────

export interface TeamDirectoryPaths {
	teamDir: string; // .openagent/team/
	teamMd: string; // .openagent/team/TEAM.md
	membersDir: string; // .openagent/team/members/
	sharedDir: string; // .openagent/team/shared/
	memberIndex: (name: MemberName) => string; // .openagent/team/members/<name>.md
	memberTopics: (name: MemberName) => string; // .openagent/team/members/<name>/
	memberTopic: (name: MemberName, topic: string) => string; // .openagent/team/members/<name>/<topic>.md
	sharedTopic: (topic: string) => string; // .openagent/team/shared/<topic>.md
	archivedMember: (name: MemberName) => string; // .openagent/team/members/_archived/<name>/
}

// ─── TeamManagerLike (replaces WorkerSessionPoolLike) ───────

export interface TeamManagerLike {
	// Member lifecycle
	createMember(opts: {
		name: MemberName;
		role: string;
		goal: string;
		constraints?: string;
		model?: string;
		services: SubagentServices;
		parentModel?: ResolvedModel;
		tools?: string[];
		skills?: string[];
		mcps?: string[];
	}): Promise<MemberState>;
	removeMember(name: MemberName): Promise<void>;
	getMember(name: MemberName): MemberState | undefined;
	listMembers(): MemberState[];

	// Task management
	assignTask(opts: {
		title: string;
		description: string;
		memberName: MemberName;
		priority?: "high" | "medium" | "low";
		type?: TaskType;
	}): TaskState;
	startDiscussion(opts: {
		title: string;
		description: string;
		participants: MemberName[];
		priority?: "high" | "medium" | "low";
	}): TaskState;
	completeTask(taskId: string): void;
	listTasks(): TaskState[];

	// Memory operations
	writeMemory(opts: {
		memberName: MemberName;
		type: MemoryType;
		topic: string;
		content: string;
		shared?: boolean;
	}): Promise<void>;
	readMemberIndex(name: MemberName): MemberIndexStructure | null;
	readTopicFile(
		name: MemberName,
		topic: string,
	): (TopicFileFrontmatter & { content: string }) | null;
	readTeamMd(): TeamMdStructure;

	// Member lifecycle control
	pauseMember(name: MemberName): void;
	resumeMember(name: MemberName): void;
	cancelMember(name: MemberName): void;
	directMember(name: MemberName, kind: "directive" | "context" | "redirect", payload: string): void;

	// Member-to-member messaging
	sendMessage(opts: { from: MemberName; to: MemberName; content: string }): {
		message: MemberMessage;
		delivery: DeliveryMode;
	};
	broadcastMessage(opts: {
		from: MemberName;
		content: string;
	}): Array<{ message: MemberMessage; delivery: DeliveryMode }>;
	readInbox(name: MemberName, opts?: ReadInboxOptions): MemberMessage[];
	markInboxRead(name: MemberName, ids?: string[]): number;

	getMaxWorkers(): number;

	// Member identity (for tool permission checks)
	isSelfMember(name: MemberName): boolean;
	getSelfMemberName(): MemberName | undefined;

	// Lifecycle
	dispose(): Promise<void>;
	subscribe(listener: (event: TeamEvent) => void): () => void;
}

// ─── Events ─────────────────────────────────────────────────

export type TeamEvent =
	| { type: "member_created"; memberName: MemberName }
	| { type: "member_removed"; memberName: MemberName }
	| { type: "task_assigned"; taskId: string; memberName: MemberName }
	| { type: "task_completed"; taskId: string; memberName: MemberName }
	| {
			type: "member_done";
			memberName: MemberName;
			summary: string;
			cost: number;
			inputTokens: number;
			outputTokens: number;
			turnCount: number;
			durationMs: number;
			model?: string;
	  }
	| { type: "member_error"; memberName: MemberName; error: string }
	| { type: "member_paused"; memberName: MemberName }
	| { type: "member_resumed"; memberName: MemberName }
	| { type: "member_cancelled"; memberName: MemberName }
	| { type: "team_md_updated"; section: string }
	| { type: "memory_written"; memberName: MemberName; topic: string; memoryType: MemoryType }
	| { type: "members_restored"; memberNames: MemberName[] }
	| {
			type: "member_message_sent";
			from: MemberName;
			to: MemberName | typeof BROADCAST_RECIPIENT;
			messageId: string;
			delivery: DeliveryMode;
	  }
	| { type: "member_message_read"; by: MemberName; count: number };

/** Lazy reference to TeamManager — mirrors WorkerPoolRef pattern. */
export interface TeamManagerRef {
	current: TeamManagerLike | null;
}
