/**
 * Background job types.
 *
 * A background job is a detached unit of work tracked by
 * {@link ./service.ts:BackgroundJobService}. The job ID is always the child
 * AgentSession ID, so callers can correlate jobs with sessions for cancel/steer.
 */
import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";

export type JobStatus = "running" | "completed" | "error" | "cancelled";

export type JobType = "subagent" | "btw";

export interface ActiveJob {
	/** Unique ID — equal to the child AgentSession ID. */
	id: string;
	type: JobType;
	title: string;
	status: JobStatus;
	startedAt: number;
	completedAt: number | null;
	/** Last assistant text output (or error message). Null while running. */
	output: string | null;
	/** Error message when status === "error". Null otherwise. */
	error: string | null;
	metadata: Record<string, unknown>;
}

export interface StartJobOpts {
	id: string;
	type: JobType;
	title: string;
	/** Child session handle — kept for cancel/steer queries. */
	session: AgentSession;
	/**
	 * Detached work. Must return the output text on success.
	 * The service disposes the session after this resolves or rejects.
	 */
	run: () => Promise<string>;
	/** Fired once when the job leaves "running" (success, error, or cancel). */
	onComplete?: (job: ActiveJob) => void;
	/** Optional event listener wired to `session.subscribe`. Unsubbed on cleanup. */
	onEvent?: (event: AgentSessionEvent) => void;
}

/** Matches MAX_PARALLEL_TASKS (src/agents/types.ts). */
export const MAX_BG_JOBS = 8;

/** Mutable ref so tools created before the parent session can reach it later. */
export type SessionRef = { current: AgentSession | null };
