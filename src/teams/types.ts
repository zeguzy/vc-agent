/**
 * Teams 模式核心类型定义。
 *
 * 该文件是 `src/teams/` 整个模块的类型契约源——manager.ts、worker.ts、tools/team.ts 与
 * src/server/index.ts 均从此 import。自包含（不引用 ../manager.js ），故可独立 typecheck。
 *
 * 关键设计（详见 design.md D1 / D2 / D9 / D10）:
 * - Worker 持有独立 Pi SDK AgentSession，事件经 `WorkerEventEnvelope` 聚合后转发给 AgentServer
 * - `WorkerPoolRef` 用 `{ current: WorkerSessionPoolLike | null }` 单例延迟注入路径（team 工具通过它访问 pool）
 * - `AgentClientEvent` 是 AgentServer 总线统一类型；`AgentSessionEvent` 子集向后兼容现有 handler
 * - V1 不允许 `permissionMode: "bypass"`（详见 `AgentDefinition.permissionMode` 与 agent-session spec）
 */

import type { AgentSessionEvent, ModelRegistry } from "@earendil-works/pi-coding-agent";

import type { AgentConfig, SubagentServices } from "../agents/types.js";

/** Worker id，稳定生命周期唯一。格式：`wkr_<8 字符 base32>`。 */
export type WorkerId = string;

/** Worker 生命周期状态。 */
export type WorkerStatus =
	| "running" // session.prompt 进行中
	| "idle" // 已 spawn 但尚未真正进入 prompt（瞬时）
	| "done" // agent_end 正常完成
	| "error" // prompt reject / maxTurns 命中 / 网络 drop / 工具调用 forbidden 嵌套
	| "cancelled"; // 被 cancelWorker / cancelAll 主动中止

/** WorkerEvent 经 WorkerSessionPool 转发时的分类 kind——与 Pi SDK event.type 对齐但便于订阅者路由。 */
export type WorkerEventKind =
	| "message_delta" // 含 text_delta 的 message_update（流式 token）
	| "message_end" // assistant 消息终结
	| "tool_call" // tool_execution_start
	| "tool_result" // tool_execution_end
	| "agent_end" // session agent_end（worker 完整回合终态）
	| "error"; // worker 内部抛错或被 cancel

/** 经 `WorkerSessionPool` 聚合后转发到 AgentServer.eventHandlers 的包装事件。 */
export interface WorkerEventEnvelope {
	/** 固定为 `"team_worker_event"`，订阅者据此收窄判断，不污染现有 AgentSessionEvent.type 取值集。 */
	readonly type: "team_worker_event";
	/** 所属 worker id。 */
	readonly workerId: WorkerId;
	/** worker 使用的 agent 定义的 `name` 字段（如 `"lysosome"`）。 */
	readonly workerAgent: string;
	/** 事件类别（worker 生命周期视角）。 */
	readonly kind: WorkerEventKind;
	/** 原始 Pi SDK 事件，保留以供订阅者透传。 */
	readonly payload: AgentSessionEvent;
}

/** 主 agent 结束或 session 切换自动取消孤儿 worker 时下发的通知事件。 */
export interface TeamOrphansCancelledEvent {
	readonly type: "team_orphans_cancelled";
	readonly workerIds: WorkerId[];
	/** 触发场景：`"agent_end"` 或 `"session_change"`，便于订阅者差异化提示。 */
	readonly cause: "agent_end" | "session_change";
}

/** AgentServer 事件总线统一类型；现有 `AgentSessionEvent` 子集向后兼容现有 handler。 */
export type AgentClientEvent = AgentSessionEvent | WorkerEventEnvelope | TeamOrphansCancelledEvent;

/** 对外暴露的 worker 状态快照（list / get 返回；不含 session 实例引用等运行期 opaque 句柄）。 */
export interface WorkerSnapshot {
	id: WorkerId;
	/** agent 定义的 name 字段 */
	agent: string;
	status: WorkerStatus;
	turnCount: number;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	cost: number;
	/** 最近一次 assistant 最终文本（poll 时回传主 agent 的 summary；null 表示未结束或无文本）。 */
	lastSummary: string | null;
	/** 仅在 status = "error" 时填，取自 `error.message`（兜底 `String(error)`）。 */
	lastError: string | null;
	/** worker spawn 时间戳（`Date.now()`）。 */
	createdAt: number;
}

/** worker 权限配置 - V1 worker 工具收口的辅助约束。值缺省时按下文默认生效。 */
export interface TeamWorkerPermissions {
	/** bash 命令前缀白名单。**空数组（默认）等于禁用 worker 的 bash**——避免误把空数组当成"无限制"。 */
	bashCommandAllowlist?: string[];
	/** 网络受限：true 时 worker 不注入 webfetch 工具，即便 frontmatter `tools` 含 `webfetch`。 */
	networkRestricted?: boolean;
}

/** 完整 teams 配置块；未填则按 `DEFAULT_TEAM_CONFIG` 默认值生效。 */
export interface TeamConfig {
	/** 整体启用 teams 模式（默认 true）。false 时主 agent 不在 active tools 看到 team 工具、不加载 orchestrator prompt。 */
	enabled?: boolean;
	/** 默认 worker 模型。未声明 agent.model 时优先用此值，再无效时回退 parentModel。 */
	defaultWorkerModel?: string;
	/** 同时运行 worker 数上限。默认 4。超限 spawn 立即抛错而非排队（参见 design D7）。 */
	maxWorkers?: number;
	/** 默认 worker 最大轮次。默认 8。frontmatter `agent.maxTurns` 优先于此值。 */
	defaultMaxTurns?: number;
	/** V2 占位字段。V1 接受 `"none"` 或 `"worktree"`，后者作为 reserved 视同 `"none"` 并 stderr warn。 */
	isolation?: "none" | "worktree";
	/** 主 agent 结束时是否自动 cancelAll 孤儿 worker（默认 true）。 */
	cancelOrphansOnAgentEnd?: boolean;
	/** 主 session 切换时是否自动 cancelAll 孤儿 worker（默认 true）。 */
	cancelOrphansOnSessionChange?: boolean;
	/** worker 工具收口配置。 */
	workerPermissions?: TeamWorkerPermissions;
	/** V2: idle 成员数上限，默认 maxWorkers * 2 */
	maxIdleMembers?: number;
	/** V2: 消息历史保留条数，默认 100 */
	messageHistoryLimit?: number;
	/** V2: 每成员每分钟消息发送上限，默认 5 */
	messageRateLimitPerMinute?: number;
}

/** 把缺省字段补齐后的 Team 配置（内部直接消费）。 */
export interface ResolvedTeamConfig {
	enabled: boolean;
	maxWorkers: number;
	defaultMaxTurns: number;
	isolation: "none" | "worktree";
	cancelOrphansOnAgentEnd: boolean;
	cancelOrphansOnSessionChange: boolean;
	defaultWorkerModel?: string;
	workerPermissions?: TeamWorkerPermissions;
	/** idle 成员数上限 */
	maxIdleMembers: number;
	/** 消息历史保留条数 */
	messageHistoryLimit: number;
	/** 每成员每分钟消息发送上限 */
	messageRateLimitPerMinute: number;
}

/** 简化了 V1 默认配置集合（fields 必填，options 仍可缺省）。 */
export const DEFAULT_TEAM_CONFIG: Pick<
	ResolvedTeamConfig,
	| "enabled"
	| "maxWorkers"
	| "defaultMaxTurns"
	| "isolation"
	| "cancelOrphansOnAgentEnd"
	| "cancelOrphansOnSessionChange"
	| "maxIdleMembers"
	| "messageHistoryLimit"
	| "messageRateLimitPerMinute"
> = {
	enabled: true,
	maxWorkers: 4,
	defaultMaxTurns: 8,
	isolation: "none",
	cancelOrphansOnAgentEnd: true,
	cancelOrphansOnSessionChange: true,
	maxIdleMembers: 8,
	messageHistoryLimit: 100,
	messageRateLimitPerMinute: 5,
};

/** 把未填字段补齐为解析后的全量配置。无 undefined 字段简化下游使用。 */
export function resolveTeamConfig(raw: TeamConfig | undefined): ResolvedTeamConfig {
	const d = DEFAULT_TEAM_CONFIG;
	if (!raw) {
		return { ...d };
	}
	return {
		enabled: raw.enabled ?? d.enabled,
		maxWorkers: raw.maxWorkers ?? d.maxWorkers,
		defaultMaxTurns: raw.defaultMaxTurns ?? d.defaultMaxTurns,
		isolation: raw.isolation ?? d.isolation,
		cancelOrphansOnAgentEnd: raw.cancelOrphansOnAgentEnd ?? d.cancelOrphansOnAgentEnd,
		cancelOrphansOnSessionChange:
			raw.cancelOrphansOnSessionChange ?? d.cancelOrphansOnSessionChange,
		defaultWorkerModel: raw.defaultWorkerModel,
		workerPermissions: raw.workerPermissions,
		maxIdleMembers: raw.maxIdleMembers ?? d.maxIdleMembers,
		messageHistoryLimit: raw.messageHistoryLimit ?? d.messageHistoryLimit,
		messageRateLimitPerMinute: raw.messageRateLimitPerMinute ?? d.messageRateLimitPerMinute,
	};
}

/** WorkerSessionPool 公共接口契约——`WorkerPoolRef.current` 通过该类型暴露给 team 工具。 */
export interface WorkerSessionPoolLike {
	spawnWorker(opts: WorkerSpawnOptions): Promise<{ workerId: WorkerId; status: WorkerStatus }>;
	get(id: WorkerId): WorkerSnapshot | undefined;
	list(): WorkerSnapshot[];
	runningCount(): number;
	cancel(id: WorkerId): Promise<void>;
	cancelAll(): Promise<void>;
	dispose(): Promise<void>;
	subscribe(listener: (event: WorkerEventEnvelope) => void): () => void;
	// V2 team methods
	createMember(opts: {
		name: string;
		role: string;
		goal: string;
		model?: string;
		tools?: string[];
		systemPrompt?: string;
	}): TeamMember;
	removeMember(id: MemberId): void;
	getMember(id: MemberId): TeamMember | undefined;
	listMembers(): TeamMember[];
	assignTask(opts: {
		title: string;
		description: string;
		memberId: MemberId;
		priority?: "high" | "medium" | "low";
	}): TeamTask;
	listTasks(): TeamTask[];
	taskStatus(taskId: string): TeamTask | undefined;
	sendMessage(from: MemberId, to: MemberId | "team", content: string): void;
	readInbox(memberId?: MemberId): TeamMessage[];
}

/**
 * `WorkerPoolRef`：用于实现 design D2 "延迟 owner 注入路径"——team 工具作为 customTool 在 `initServices`
 * 中创建，此时 `AgentServer` 尚未构造，故暂持有 `{ current: null }`；AgentServer 构造后立即填充 `poolRef.current`。
 *
 * team.execute 读取 `poolRef.current`：
 * - 若 null → 返回 isError `"teams not initialized yet"`（理论上不会发生在正常启动流，仅防御）
 * - 若非 null → 正常执行
 */
export interface WorkerPoolRef {
	current: WorkerSessionPoolLike | null;
}

/** Worker 实例的事件总线接口——pool `subscribe` 派发来自 worker.subscribe 的 envelope。 */
export interface WorkerEventEmitter {
	/** 内部用于把原始 Pi SDK event 包装为 envelope 后 emit。 */
	emit(kind: WorkerEventKind, payload: AgentSessionEvent): void;
	/** 订阅所有 WorkerEventEnvelope；返回 unsubscribe。 */
	subscribe(listener: (event: WorkerEventEnvelope) => void): () => void;
	/** dispose：清空所有 listener。 */
	dispose(): void;
}

// ============================================================================
// Team Member Model — V2 团队成员系统（替换 Worker 模型）
// ============================================================================

/** 成员 id，稳定生命周期唯一。格式：`mem_<8 字符 base32>`。 */
export type MemberId = string;

/** 成员生命周期状态。 */
export type MemberStatus =
	| "idle" // 已创建但未启动
	| "working" // session.prompt 进行中
	| "done" // agent_end 正常完成
	| "error" // prompt reject / maxTurns 命中 / 网络 drop
	| "cancelled"; // 被 cancel 主动中止

/** 团队成员身份模型。Leader 动态创建，不限预设角色。 */
export interface TeamMember {
	id: MemberId;
	/** Leader 指定的拟人化名字 */
	name: string;
	/** Leader 指定的职责描述 */
	role: string;
	/** Leader 指定的目标 */
	goal: string;
	status: MemberStatus;
	model: string;
	tools?: string[];
	systemPrompt?: string;
	permissionMode?: "default" | "plan" | "acceptEdits";
	/** 对话历史摘要 */
	context: string[];
	turnCount: number;
	inputTokens: number;
	outputTokens: number;
	cost: number;
	lastSummary: string | null;
	lastError: string | null;
	createdAt: number;
}

/** 任务优先级。 */
export type TaskPriority = "high" | "medium" | "low";

/** 任务状态。 */
export type TaskStatus = "open" | "assigned" | "in_progress" | "done" | "blocked";

/** 任务池中的任务。 */
export interface TeamTask {
	id: string;
	title: string;
	description: string;
	assignedTo?: MemberId;
	status: TaskStatus;
	priority: TaskPriority;
	result?: string;
	blockReason?: string;
}

/** 团队成员间消息。 */
export interface TeamMessage {
	id: string;
	from: MemberId;
	to: MemberId | "team";
	content: string;
	timestamp: number;
}

/** 成员事件分类 kind — 与 WorkerEventKind 对齐。 */
export type MemberEventKind = WorkerEventKind;

/** TeamSession 转发给订阅者的成员事件。 */
export interface TeamMemberEvent {
	readonly type: "team_member_event";
	readonly memberId: MemberId;
	readonly memberName: string;
	readonly kind: MemberEventKind;
	readonly payload: AgentSessionEvent;
}

/** AgentServer 事件总线统一类型（V2 成员事件加入）。 */
export type AgentClientEventV2 =
	| AgentSessionEvent
	| WorkerEventEnvelope
	| TeamMemberEvent
	| TeamOrphansCancelledEvent;

/** 团队配置扩展。 */
export interface TeamConfigV2 extends TeamConfig {
	/** idle 成员数上限，默认 maxWorkers * 2 */
	maxIdleMembers?: number;
	/** 消息历史保留条数，默认 100 */
	messageHistoryLimit?: number;
	/** 每成员每分钟消息发送上限，默认 5 */
	messageRateLimitPerMinute?: number;
}

// ============================================================================
// Deprecated — V1 Worker 模型，保留兼容层
// ============================================================================

/** @deprecated V2 成员模型替代。保留 `generateMemberId` 和 `TeamMember` 系统。 */
export type ResolvedModel = ReturnType<ModelRegistry["getAll"]>[number];

/**
 * @deprecated 使用 `generateMemberId()` 替代。
 * 生成形如 `mem_<8 字符 base32>` 的新 memberId。
 */
export function generateMemberId(): MemberId {
	const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
	const rand = new Uint8Array(8);
	(globalThis.crypto as Crypto).getRandomValues(rand);
	let suffix = "";
	for (const b of rand) suffix += alphabet[b % 32];
	return `mem_${suffix}`;
}

/**
 * @deprecated 使用 `generateMemberId()` 替代。
 */
export function generateWorkerId(): WorkerId {
	return generateMemberId().replace(/^mem_/, "wkr_");
}

export interface WorkerSpawnOptions {
	agent: AgentConfig;
	task: string;
	cwd: string;
	services: SubagentServices;
	parentModel?: ResolvedModel;
	defaultMaxTurns?: number;
	defaultWorkerModel?: string;
	signal?: AbortSignal;
	onDelta?: (text: string) => void;
}
