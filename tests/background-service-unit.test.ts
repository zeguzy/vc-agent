import { describe, expect, it } from "bun:test";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { BackgroundJobService } from "../src/background/service.js";
import { type ActiveJob, MAX_BG_JOBS } from "../src/background/types.js";

function createMockSession(opts?: {
	abortThrows?: boolean;
	disposeThrows?: boolean;
}): AgentSession {
	const listeners: ((event: unknown) => void)[] = [];
	return {
		sessionId: `mock-${Math.random().toString(36).slice(2, 10)}`,
		subscribe: (fn: (event: unknown) => void) => {
			listeners.push(fn);
			return () => {
				const idx = listeners.indexOf(fn);
				if (idx >= 0) listeners.splice(idx, 1);
			};
		},
		abort: async () => {
			if (opts?.abortThrows) throw new Error("abort failed");
		},
		dispose: () => {
			if (opts?.disposeThrows) throw new Error("dispose failed");
		},
	} as unknown as AgentSession;
}

describe("BackgroundJobService", () => {
	describe("start → complete", () => {
		it("transitions running → completed when run resolves", async () => {
			const svc = new BackgroundJobService();
			const session = createMockSession();
			const job = svc.start({
				id: "job-1",
				type: "subagent",
				title: "test task",
				session,
				run: async () => "done output",
			});

			expect(job.status).toBe("running");
			expect(job.output).toBeNull();

			const final = await svc.wait("job-1");
			expect(final?.status).toBe("completed");
			expect(final?.output).toBe("done output");
			expect(final?.error).toBeNull();
			expect(final?.completedAt).not.toBeNull();
		});

		it("fires onComplete with the final job", async () => {
			const svc = new BackgroundJobService();
			let completedJob: ActiveJob | null = null;
			svc.start({
				id: "job-2",
				type: "subagent",
				title: "test",
				session: createMockSession(),
				run: async () => "ok",
				onComplete: (job) => {
					completedJob = job;
				},
			});
			await svc.wait("job-2");
			expect(completedJob?.status).toBe("completed");
		});

		it("disposes the session after completion", async () => {
			const svc = new BackgroundJobService();
			let disposed = false;
			const session = createMockSession({
				disposeThrows: false,
			});
			(session as { dispose: () => void }).dispose = () => {
				disposed = true;
			};
			svc.start({
				id: "job-3",
				type: "subagent",
				title: "test",
				session,
				run: async () => "done",
			});
			await svc.wait("job-3");
			expect(disposed).toBe(true);
		});
	});

	describe("start → cancel", () => {
		it("transitions running → cancelled and aborts the session", async () => {
			const svc = new BackgroundJobService();
			let aborted = false;
			const session = createMockSession();
			(session as { abort: () => Promise<void> }).abort = async () => {
				aborted = true;
			};

			const job = svc.start({
				id: "job-cancel",
				type: "subagent",
				title: "cancellable",
				session,
				run: () =>
					new Promise<string>(() => {
						// Never resolves — only cancel can end this
					}),
			});

			expect(job.status).toBe("running");
			const cancelled = await svc.cancel("job-cancel");
			expect(cancelled?.status).toBe("cancelled");
			expect(cancelled?.completedAt).not.toBeNull();
			expect(aborted).toBe(true);
		});
	});

	describe("start → error", () => {
		it("transitions running → error when run rejects", async () => {
			const svc = new BackgroundJobService();
			svc.start({
				id: "job-err",
				type: "subagent",
				title: "will fail",
				session: createMockSession(),
				run: async () => {
					throw new Error("task exploded");
				},
			});

			const final = await svc.wait("job-err");
			expect(final?.status).toBe("error");
			expect(final?.error).toBe("task exploded");
			expect(final?.output).toBeNull();
		});

		it("fires onComplete on error too", async () => {
			const svc = new BackgroundJobService();
			let completedJob: ActiveJob | null = null;
			svc.start({
				id: "job-err-cb",
				type: "subagent",
				title: "fail",
				session: createMockSession(),
				run: async () => {
					throw new Error("boom");
				},
				onComplete: (job) => {
					completedJob = job;
				},
			});
			await svc.wait("job-err-cb");
			expect(completedJob?.status).toBe("error");
		});
	});

	describe("list / get", () => {
		it("list returns all registered jobs", async () => {
			const svc = new BackgroundJobService();
			svc.start({
				id: "a",
				type: "subagent",
				title: "a",
				session: createMockSession(),
				run: async () => "1",
			});
			svc.start({
				id: "b",
				type: "btw",
				title: "b",
				session: createMockSession(),
				run: async () => "2",
			});
			const list = svc.list();
			expect(list).toHaveLength(2);
			expect(list.map((j) => j.id).sort()).toEqual(["a", "b"]);
		});

		it("get returns a single job by id", async () => {
			const svc = new BackgroundJobService();
			svc.start({
				id: "x",
				type: "subagent",
				title: "x",
				session: createMockSession(),
				run: async () => "x",
			});
			const job = svc.get("x");
			expect(job?.id).toBe("x");
			expect(svc.get("nonexistent")).toBeUndefined();
		});
	});

	describe("promote", () => {
		it("sets metadata.background = true", async () => {
			const svc = new BackgroundJobService();
			svc.start({
				id: "p",
				type: "subagent",
				title: "p",
				session: createMockSession(),
				run: () =>
					new Promise<string>(() => {
						// Never resolves
					}),
			});
			const promoted = svc.promote("p");
			expect(promoted?.metadata.background).toBe(true);
		});

		it("returns undefined for unknown id", () => {
			const svc = new BackgroundJobService();
			expect(svc.promote("nope")).toBeUndefined();
		});
	});

	describe("dispose", () => {
		it("cancels all running jobs", async () => {
			const svc = new BackgroundJobService();
			const job1 = svc.start({
				id: "d1",
				type: "subagent",
				title: "d1",
				session: createMockSession(),
				run: () =>
					new Promise<string>(() => {
						// Never resolves
					}),
			});
			const job2 = svc.start({
				id: "d2",
				type: "subagent",
				title: "d2",
				session: createMockSession(),
				run: () =>
					new Promise<string>(() => {
						// Never resolves
					}),
			});

			await svc.dispose();
			expect(job1.status).toBe("cancelled");
			expect(job2.status).toBe("cancelled");
			expect(svc.list()).toHaveLength(0);
		});

		it("is safe to call when empty", async () => {
			const svc = new BackgroundJobService();
			await svc.dispose();
			expect(svc.list()).toHaveLength(0);
		});

		it("is safe to call multiple times", async () => {
			const svc = new BackgroundJobService();
			svc.start({
				id: "m",
				type: "subagent",
				title: "m",
				session: createMockSession(),
				run: async () => "ok",
			});
			await svc.wait("m");
			await svc.dispose();
			await svc.dispose();
		});
	});

	describe("MAX_BG_JOBS", () => {
		it("rejects start when at capacity", () => {
			const svc = new BackgroundJobService();
			for (let i = 0; i < MAX_BG_JOBS; i++) {
				svc.start({
					id: `cap-${i}`,
					type: "subagent",
					title: `cap-${i}`,
					session: createMockSession(),
					run: () =>
						new Promise<string>(() => {
							// Never resolves
						}),
				});
			}
			expect(() =>
				svc.start({
					id: "overflow",
					type: "subagent",
					title: "overflow",
					session: createMockSession(),
					run: async () => "ok",
				}),
			).toThrow(/capacity/);
		});

		it("allows new jobs after old ones complete", async () => {
			const svc = new BackgroundJobService();
			svc.start({
				id: "c1",
				type: "subagent",
				title: "c1",
				session: createMockSession(),
				run: async () => "ok",
			});
			await svc.wait("c1");
			expect(() =>
				svc.start({
					id: "c2",
					type: "subagent",
					title: "c2",
					session: createMockSession(),
					run: async () => "ok",
				}),
			).not.toThrow();
		});

		it("rejects duplicate id", () => {
			const svc = new BackgroundJobService();
			svc.start({
				id: "dup",
				type: "subagent",
				title: "dup",
				session: createMockSession(),
				run: () =>
					new Promise<string>(() => {
						// Never resolves
					}),
			});
			expect(() =>
				svc.start({
					id: "dup",
					type: "subagent",
					title: "dup",
					session: createMockSession(),
					run: async () => "ok",
				}),
			).toThrow(/already registered/);
		});
	});
});
