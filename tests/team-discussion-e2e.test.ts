/**
 * Team discussion E2E test (real LLM, real server).
 *
 * Skipped by default — enable with `RUN_LLM_TESTS=1`. Consumes LLM tokens:
 * 3 members each run 1-N turns + coordinator runs once per round, capped by
 * DISCUSSION_MAX_ROUNDS=10. Single-test deadline 200s.
 *
 * Pattern follows acceptance-smoke.test.ts: createRealServer (HOME isolation)
 * + createHttpServer (127.0.0.1, port 0) + HttpClient class (no raw fetch).
 *
 * Structural assertions only — does NOT validate LLM output quality, only:
 *   1. Task transitions in_progress → done
 *   2. At least one member-to-member message exchanged (inbox non-empty)
 *   3. At least one coordinator decision logged (discussion_evaluated event)
 *
 * LOG_DIR NOTE: src/teams/logger.ts captures homedir() at module load (before
 * createRealServer rewrites process.env.HOME), so logs land under the real
 * HOME. We cache REAL_HOME at file load to read them back.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { HttpClient } from "../src/client/http.js";
import { createHttpServer } from "../src/server/http.js";
import type { AgentServer } from "../src/server/index.js";
import { createRealServer } from "./helpers/real-server.js";

const ENABLED = process.env.RUN_LLM_TESTS === "1";
const REAL_HOME = process.env.HOME ?? homedir();

function todayLogPath(): string {
	const date = new Date().toISOString().slice(0, 10);
	return join(REAL_HOME, ".config", "openagent", "logs", "teams", `${date}.jsonl`);
}

function readTodayLog(): Array<Record<string, unknown>> {
	const path = todayLogPath();
	if (!existsSync(path)) return [];
	return readFileSync(path, "utf-8")
		.trim()
		.split("\n")
		.filter(Boolean)
		.map((line) => {
			try {
				return JSON.parse(line) as Record<string, unknown>;
			} catch {
				return null;
			}
		})
		.filter((v): v is Record<string, unknown> => v !== null);
}

describe.skipIf(!ENABLED)("Team discussion E2E via HttpClient (real LLM)", () => {
	let server: AgentServer;
	let httpServer: ReturnType<typeof createHttpServer>;
	let baseUrl: string;
	let client: HttpClient;
	let restoreHome: (() => void) | undefined;

	beforeAll(async () => {
		const result = await createRealServer();
		server = result.server;
		restoreHome = result.restoreHome;
		httpServer = createHttpServer({ server, port: 0, host: "127.0.0.1" });
		const address = httpServer.address();
		const port = typeof address === "object" && address ? address.port : 0;
		baseUrl = `http://127.0.0.1:${port}`;
		client = new HttpClient(baseUrl);
		await client.init();
	}, 30000);

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

	it("discussion task completes: members communicate, coordinator drives rounds, task reaches done", async () => {
		const memberNames = ["alice", "bob", "carol"];
		for (const name of memberNames) {
			await client.createMember({
				name,
				role: "discussant",
				goal: `Participate in the team discussion as ${name}. Share your view, read others' messages, and work toward consensus.`,
				tools: ["message", "read"],
			});
		}

		const task = await client.assignTask({
			title: "Pick a number between 1 and 10",
			description:
				"The team must agree on a single integer between 1 and 10. Each member should propose a number and explain why, then converge on one answer.",
			memberName: "alice",
			type: "discussion",
		});
		expect(task.type).toBe("discussion");
		expect(task.done).toBe(false);

		const deadline = Date.now() + 180_000;
		let finalTask = task;
		while (Date.now() < deadline) {
			await new Promise((r) => setTimeout(r, 3000));
			const fetched = await client.fetchTaskStatus(task.id);
			if (fetched) finalTask = fetched;
			if (finalTask?.done) break;
		}

		expect(finalTask).toBeDefined();
		expect(finalTask.done).toBe(true);

		let foundMessage = false;
		for (const name of memberNames) {
			const inbox = await client.fetchInbox(name);
			if (inbox.length > 0) {
				foundMessage = true;
				break;
			}
		}
		expect(foundMessage).toBe(true);

		const entries = readTodayLog();
		const discussionEvents = entries.filter((e) => e.event === "discussion_evaluated");
		expect(discussionEvents.length).toBeGreaterThan(0);

		const lastEvent = discussionEvents[discussionEvents.length - 1];
		expect(lastEvent.action).toMatch(/^(continue|complete)$/);
		expect(typeof lastEvent.round).toBe("number");
		expect(typeof lastEvent.taskId).toBe("string");
	}, 200_000);

	it("HttpClient.assignTask returns execution type when type omitted", async () => {
		const execTask = await client.assignTask({
			title: "Plain execution task",
			description: "Default type should be execution",
			memberName: "alice",
		});
		expect(execTask.type).toBe("execution");
	});
});
