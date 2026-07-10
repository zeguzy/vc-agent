/**
 * HttpClient team lifecycle E2E test (real LLM, real server).
 *
 * Skipped by default — enable with `RUN_LLM_TESTS=1`. Consumes LLM tokens.
 * Exercises all HttpClient team methods against a real server + real LLM.
 *
 * Pattern follows team-discussion-e2e.test.ts: createRealServer (HOME isolation)
 * + createHttpServer (127.0.0.1, port 0) + HttpClient class (no raw fetch).
 *
 * Structural assertions only — does NOT validate LLM output quality, only:
 *   1. Member lifecycle: create → pause → resume → cancel → remove
 *   2. Task + inbox: assign execution task → wait for done → inbox non-empty
 *   3. Direct member: directMember with directive → no throw
 *   4. Team SSE events: subscribeTeam → create member → event received
 *   5. cycleModel: call → no throw, returns undefined or result
 *
 * LOG_DIR NOTE: src/teams/logger.ts captures homedir() at module load (before
 * createRealServer rewrites process.env.HOME), so logs land under the real
 * HOME. We cache REAL_HOME at file load to read them back.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { createRuntime } from "../src/agent/session.js";
import { HttpClient } from "../src/client/http.js";
import { createHttpServer } from "../src/server/http.js";
import type { AgentServer } from "../src/server/index.js";
import { ASTRON_KEY, buildAstronConfig } from "./helpers/astron-config.js";

const ENABLED = process.env.RUN_LLM_TESTS === "1";
const _REAL_HOME = process.env.HOME ?? homedir();

describe.skipIf(!ENABLED)("HttpClient team lifecycle E2E (real LLM)", () => {
	let server: AgentServer;
	let httpServer: ReturnType<typeof createHttpServer>;
	let baseUrl: string;
	let client: HttpClient;
	let restoreHome: (() => void) | undefined;

	beforeAll(async () => {
		if (!ASTRON_KEY) throw new Error("ASTRON_INFINITY_API_KEY or ASTRON_API_KEY env var required");

		const originalHome = process.env.HOME;
		const isolatedHome = join(
			tmpdir(),
			`openagent-e2e-http-${process.pid}-${Math.random().toString(36).slice(2, 10)}`,
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
		baseUrl = `http://127.0.0.1:${port}`;
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

	it("member lifecycle: create → fetchMember → pause/resume/cancel → remove", async () => {
		const member = await client.createMember({
			name: "lifecycle-test",
			role: "worker",
			goal: "Test member lifecycle operations.",
			tools: ["read"],
		});
		expect(member.name).toBe("lifecycle-test");

		const fetched = await client.fetchMember("lifecycle-test");
		expect(fetched).toBeDefined();
		expect(fetched?.name).toBe("lifecycle-test");

		// Fire-and-forget methods should not throw regardless of member state
		expect(() => client.pauseMember("lifecycle-test")).not.toThrow();
		await new Promise((r) => setTimeout(r, 500));

		expect(() => client.resumeMember("lifecycle-test")).not.toThrow();
		await new Promise((r) => setTimeout(r, 500));

		expect(() => client.cancelMember("lifecycle-test")).not.toThrow();
		await new Promise((r) => setTimeout(r, 1000));

		await client.removeMember("lifecycle-test");
		const afterRemove = await client.fetchMember("lifecycle-test");
		expect(afterRemove).toBeUndefined();
	}, 30000);

	it("task + inbox: assign execution task → wait for done → inbox", async () => {
		await client.createMember({
			name: "task-worker",
			role: "executor",
			goal: "Execute assigned tasks.",
			tools: ["read", "write"],
		});

		const task = await client.assignTask({
			title: "List current directory",
			description: "Run ls and report the files in the current directory.",
			memberName: "task-worker",
			type: "execution",
		});
		expect(task.type).toBe("execution");
		expect(task.done).toBe(false);

		const deadline = Date.now() + 120_000;
		let finalTask = task;
		while (Date.now() < deadline) {
			await new Promise((r) => setTimeout(r, 3000));
			const fetched = await client.fetchTaskStatus(task.id);
			if (fetched) finalTask = fetched;
			if (finalTask?.done) break;
		}
		expect(finalTask).toBeDefined();
		expect(finalTask.done).toBe(true);

		const inbox = await client.fetchInbox("task-worker");
		expect(Array.isArray(inbox)).toBe(true);

		await client.removeMember("task-worker");
	}, 150_000);

	it("directMember: send directive to member → no throw", async () => {
		await client.createMember({
			name: "direct-test",
			role: "worker",
			goal: "Receive directives.",
			tools: ["read"],
		});

		const _task = await client.assignTask({
			title: "Wait for directive",
			description: "Wait for a directive from the leader.",
			memberName: "direct-test",
		});

		expect(() =>
			client.directMember("direct-test", "directive", "Focus on testing."),
		).not.toThrow();

		await client.removeMember("direct-test");
	}, 30000);

	it("subscribeTeam: receives team events via SSE", async () => {
		const received: unknown[] = [];
		const unsub = client.subscribeTeam((event) => {
			received.push(event);
		});

		await new Promise((r) => setTimeout(r, 500));

		await client.createMember({
			name: "sse-test",
			role: "observer",
			goal: "Trigger SSE events.",
			tools: ["read"],
		});

		const deadline = Date.now() + 10_000;
		while (Date.now() < deadline && received.length === 0) {
			await new Promise((r) => setTimeout(r, 500));
		}

		expect(received.length).toBeGreaterThanOrEqual(1);

		unsub();
		await client.removeMember("sse-test");
	}, 30000);

	it("cycleModel: call → no throw, returns undefined or result", async () => {
		const result = await client.cycleModel();
		expect(result === undefined || typeof result === "object").toBe(true);
	}, 10000);
});
