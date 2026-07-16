/**
 * BackgroundJobService — process-wide registry for detached background jobs.
 *
 * Lifecycle mirrors `src/teams/worker.ts` Worker class:
 * - `start()` forks `run()` as a detached promise (cf. `Worker.runPromise`)
 * - Status transitions: running → completed | error | cancelled
 * - `cancel()` aborts the child session (cf. `Worker.cancel`)
 * - `dispose()` cancels every running job (cf. TeamManager.dispose cascade)
 * - Cleanup (unsub + session.dispose) runs in the finally block
 *
 * Differences from Worker:
 * - Generic (not teams-specific): no WorkerEventBus, no WorkerId
 * - Session is created by the caller and passed in (Worker.create builds its own)
 * - No maxTurns / token accounting (the caller tracks usage inside `run()`)
 */
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { type ActiveJob, MAX_BG_JOBS, type StartJobOpts } from "./types.js";

export class BackgroundJobService {
	private readonly jobs = new Map<string, ActiveJob>();
	private readonly sessions = new Map<string, AgentSession>();
	private readonly unsubs = new Map<string, () => void>();
	private readonly runPromises = new Map<string, Promise<void>>();

	/**
	 * Register and start a background job.
	 *
	 * Throws if at capacity or if the ID is already registered. The `run`
	 * callback is forked as a detached promise — this method returns
	 * immediately with the "running" ActiveJob.
	 */
	start(opts: StartJobOpts): ActiveJob {
		if (this.jobs.size >= MAX_BG_JOBS) {
			throw new Error(`Background job capacity reached (max ${MAX_BG_JOBS})`);
		}
		if (this.jobs.has(opts.id)) {
			throw new Error(`Background job already registered: ${opts.id}`);
		}

		const job: ActiveJob = {
			id: opts.id,
			type: opts.type,
			title: opts.title,
			status: "running",
			startedAt: Date.now(),
			completedAt: null,
			output: null,
			error: null,
			metadata: {},
		};

		this.jobs.set(opts.id, job);
		this.sessions.set(opts.id, opts.session);

		if (opts.onEvent) {
			const unsub = opts.session.subscribe(opts.onEvent);
			this.unsubs.set(opts.id, unsub);
		}

		// Detached execution — mirrors Worker.runPromise.
		this.runPromises.set(
			opts.id,
			(async () => {
				try {
					const output = await opts.run();
					if (job.status === "running") {
						job.status = "completed";
						job.completedAt = Date.now();
						job.output = output;
					}
				} catch (err) {
					if (job.status !== "cancelled") {
						job.status = "error";
						job.completedAt = Date.now();
						job.error = err instanceof Error ? err.message : String(err);
					}
				} finally {
					this.cleanup(opts.id);
					opts.onComplete?.(job);
				}
			})(),
		);

		return job;
	}

	/** Resolve when the job leaves "running". Returns the job (or undefined if unknown). */
	async wait(id: string): Promise<ActiveJob | undefined> {
		const promise = this.runPromises.get(id);
		if (promise) await promise;
		return this.jobs.get(id);
	}

	/** Abort the child session and mark the job cancelled. No-op on terminal jobs. */
	async cancel(id: string): Promise<ActiveJob | undefined> {
		const job = this.jobs.get(id);
		if (!job) return undefined;
		if (job.status !== "running") return job;

		job.status = "cancelled";
		job.completedAt = Date.now();

		const session = this.sessions.get(id);
		if (session) {
			try {
				await session.abort();
			} catch (err) {
				console.error(`[bg] cancel abort error for ${id}: ${err}`);
			}
		}
		this.cleanup(id);
		return job;
	}

	/** Mark a job as background (caller returns immediately). Metadata-only flag. */
	promote(id: string): ActiveJob | undefined {
		const job = this.jobs.get(id);
		if (!job) return undefined;
		job.metadata = { ...job.metadata, background: true };
		return job;
	}

	list(): ActiveJob[] {
		return [...this.jobs.values()];
	}

	get(id: string): ActiveJob | undefined {
		return this.jobs.get(id);
	}

	/** Cancel every running job and clear all maps. Safe to call multiple times. */
	async dispose(): Promise<void> {
		const ids = [...this.jobs.keys()].filter((id) => this.jobs.get(id)?.status === "running");
		await Promise.all(ids.map((id) => this.cancel(id)));
		this.jobs.clear();
		this.sessions.clear();
		this.unsubs.clear();
		this.runPromises.clear();
	}

	private cleanup(id: string): void {
		const unsub = this.unsubs.get(id);
		if (unsub) {
			try {
				unsub();
			} catch (err) {
				console.error(`[bg] unsub error for ${id}: ${err}`);
			}
			this.unsubs.delete(id);
		}
		const session = this.sessions.get(id);
		if (session) {
			try {
				session.dispose();
			} catch (err) {
				console.error(`[bg] dispose error for ${id}: ${err}`);
			}
			this.sessions.delete(id);
		}
	}
}

/** Mutable ref for the process-wide BackgroundJobService (cf. TeamManagerRef). */
export type BackgroundJobRef = { current: BackgroundJobService | null };
