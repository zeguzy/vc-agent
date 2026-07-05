import type { ModelRegistry } from "@earendil-works/pi-coding-agent";

export type ResolvedModel = ReturnType<ModelRegistry["getAll"]>[number];

export interface TeamWorkerPermissions {
	bashCommandAllowlist?: string[];
	networkRestricted?: boolean;
}

export interface TeamConfig {
	enabled?: boolean;
	defaultWorkerModel?: string;
	maxWorkers?: number;
	defaultMaxTurns?: number;
	isolation?: "none" | "worktree";
	cancelOrphansOnAgentEnd?: boolean;
	cancelOrphansOnSessionChange?: boolean;
	workerPermissions?: TeamWorkerPermissions;
	maxIdleMembers?: number;
	messageHistoryLimit?: number;
	messageRateLimitPerMinute?: number;
	agentModes?: Array<"standard" | "team" | "planner" | "orchestrator">;
}

export interface ResolvedTeamConfig {
	enabled: boolean;
	maxWorkers: number;
	defaultMaxTurns: number;
	isolation: "none" | "worktree";
	cancelOrphansOnAgentEnd: boolean;
	cancelOrphansOnSessionChange: boolean;
	defaultWorkerModel?: string;
	workerPermissions?: TeamWorkerPermissions;
	maxIdleMembers: number;
	messageHistoryLimit: number;
	messageRateLimitPerMinute: number;
}

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
