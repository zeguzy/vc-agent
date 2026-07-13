/**
 * Organic team E2E test (real LLM, real server).
 *
 * Skipped by default — enable with `RUN_LLM_TESTS=1`. Consumes LLM tokens.
 *
 * Tests the goal system lifecycle with real LLM-driven members:
 *   1. Create goal → decompose → assign task to member
 *   2. Member completes task (real LLM) → verify goal can be updated
 *   3. request-task from idle member against goal backlog
 *
 * Uses Astron ∞ (ASTRON_INFINITY_API_KEY) by default.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { createRuntime } from "../src/agent/session.js";
import { HttpClient } from "../src/client/http.js";
import { createHttpServer } from "../src/server/http.js";
import type { AgentServer } from "../src/server/index.js";
import { ASTRON_KEY, buildAstronConfig } from "./helpers/astron-config.js";

const ENABLED = process.env.RUN_LLM_TESTS === "1";

describe.skipIf(!ENABLED)("Organic team E2E (real LLM)", () => {
	let server: AgentServer;
	let httpServer: ReturnType<typeof createHttpServer>;
	let client: HttpClient;
	let restoreHome: (() => void) | undefined;

	beforeAll(async () => {
		if (!ASTRON_KEY) throw new Error("ASTRON_API_KEY or ASTRON_INFINITY_API_KEY env var required");

		const originalHome = process.env.HOME;
		const isolatedHome = join(
			tmpdir(),
			`openagent-organic-${process.pid}-${Math.random().toString(36).slice(2, 10)}`,
		);
		mkdirSync(join(isolatedHome, ".config", "openagent"), { recursive: true });
		process.env.HOME = isolatedHome;

		try {
			const { runtime, skillManager } = await createRuntime({
				cwd: process.cwd(),
				mode: "new",
				config: buildAstronConfig(),
			});
			const { createServer } = await import("../src/server/index.js");
			server = createServer({ runtime, skillManager, cwd: process.cwd() });
			restoreHome = () => {
				process.env.HOME = originalHome;
			};
		} catch (err) {
			process.env.HOME = originalHome;
			throw err;
		}

		httpServer = createHttpServer({ server, port: 0, host: "127.0.0.1" });
		const address = httpServer.address();
		const port = typeof address === "object" && address ? address.port : 0;
		const baseUrl = `http://127.0.0.1:${port}`;
		client = new HttpClient(baseUrl);
		await client.init();
	}, 60000);

	afterAll(async () => {
		try {
			const members = await client.fetchMembers();
			for (const m of members) {
				try {
					await client.removeMember(m.name);
				} catch {}
			}
		} catch {}
		httpServer.close();
		restoreHome?.();
	}, 30000);

	it(
		"goal lifecycle: create goal, assign task, member completes, goal updates",
		async () => {
			await client.createMember({
				name: "worker",
				role: "developer",
				goal: "Complete assigned tasks efficiently.",
				tools: ["read", "bash", "message"],
			});

			const goal = (
				server as unknown as { teamManager: { createGoal: (opts: unknown) => { id: string } } }
			).teamManager.createGoal({
				title: "Read project info",
				description: "Read package.json and report key info",
				priority: "high",
				successCriteria: "package.json content reported",
			});
			expect(goal.id).toBe("G1");

			const task = await client.assignTask({
				title: "Read package.json",
				description:
					"Read the package.json file in the current directory. Report the project name and version to the leader using the message tool.",
				memberName: "worker",
			});
			expect(task.done).toBe(false);

			(server as unknown as { teamManager: { linkTaskToGoal: (gid: string, tid: string) => void } })
				.teamManager.linkTaskToGoal(goal.id, task.id);

			const deadline = Date.now() + 120_000;
			let finalTask = task;
			while (Date.now() < deadline) {
				await new Promise((r) => setTimeout(r, 3000));
				const fetched = await client.fetchTaskStatus(task.id);
				if (fetched) finalTask = fetched;
				if (finalTask?.done) break;
			}
			expect(finalTask.done).toBe(true);

			(
				server as unknown as {
					teamManager: {
						updateGoal: (id: string, updates: unknown) => void;
						listGoals: () => Array<{ id: string; status: string }>;
					};
				}
			).teamManager.updateGoal(goal.id, { status: "completed" });

			const goals = (
				server as unknown as {
					teamManager: { listGoals: () => Array<{ id: string; status: string }> };
				}
			).teamManager.listGoals();
			const updated = goals.find((g) => g.id === goal.id);
			expect(updated?.status).toBe("completed");
		},
		150_000,
	);

	it(
		"goal decompose + auto-complete: parent completes when all children done",
		async () => {
			const tm = server as unknown as {
				teamManager: {
					createGoal: (opts: unknown) => { id: string };
					decomposeGoal: (
						id: string,
						subs: Array<{ title: string; description: string }>,
					) => Array<{ id: string }>;
					updateGoal: (id: string, updates: unknown) => void;
					listGoals: () => Array<{ id: string; status: string; parentGoalId: string | null }>;
				};
			}.teamManager;

			const parent = tm.createGoal({
				title: "Parent goal",
				description: "Has two children",
				priority: "high",
			});
			const subs = tm.decomposeGoal(parent.id, [
				{ title: "Child A", description: "First sub-task" },
				{ title: "Child B", description: "Second sub-task" },
			]);
			expect(subs).toHaveLength(2);

			tm.updateGoal(subs[0].id, { status: "completed" });
			let goals = tm.listGoals();
			expect(goals.find((g) => g.id === parent.id)?.status).toBe("in_progress");

			tm.updateGoal(subs[1].id, { status: "completed" });
			goals = tm.listGoals();
			expect(goals.find((g) => g.id === parent.id)?.status).toBe("completed");
		},
		30_000,
	);

	it(
		"goal tree visible in team read",
		async () => {
			const tm = server as unknown as {
				teamManager: {
					createGoal: (opts: unknown) => { id: string };
					readTeamMd: () => {
						goals: Array<{ id: string; title: string; status: string; priority: string }>;
					};
				};
			}.teamManager;

			const goal = tm.createGoal({
				title: "Visibility test goal",
				description: "Should be visible in read",
				priority: "medium",
			});

			const teamMd = tm.readTeamMd();
			expect(teamMd.goals.some((g) => g.id === goal.id && g.title === "Visibility test goal")).toBe(
				true,
			);
		},
		10_000,
	);
});
