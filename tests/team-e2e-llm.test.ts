import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createHttpServer } from "../src/server/http.js";
import type { AgentServer } from "../src/server/index.js";
import type { TeamMember, TeamTask } from "../src/teams/types.js";
import { createRealServer } from "./helpers/real-server.js";

const _RUN_LLM_TESTS = process.env.RUN_LLM_TESTS === "1";

function logDir(): string {
	return join(homedir(), ".config", "openagent", "logs", "teams");
}

function todayLogPath(): string {
	const date = new Date().toISOString().slice(0, 10);
	return join(logDir(), `${date}.jsonl`);
}

function readTodayLog(): string[] {
	const path = todayLogPath();
	if (!existsSync(path)) return [];
	return readFileSync(path, "utf-8")
		.trim()
		.split("\n")
		.filter(Boolean)
		.map((line) => {
			try {
				return JSON.parse(line);
			} catch {
				return null;
			}
		})
		.filter(Boolean);
}

describe.skip("Team E2E with real LLM", () => {
	let server: AgentServer;
	let httpServer: ReturnType<typeof createHttpServer>;
	let baseUrl: string;
	let restoreHome: (() => void) | undefined;
	const cleanupFns: (() => void)[] = [];

	beforeAll(async () => {
		const result = await createRealServer();
		server = result.server;
		restoreHome = result.restoreHome;
		httpServer = createHttpServer({ server, port: 0, host: "127.0.0.1" });
		const address = httpServer.address();
		const port = typeof address === "object" && address ? address.port : 0;
		baseUrl = `http://127.0.0.1:${port}`;
	}, 30000);

	afterAll(async () => {
		for (const fn of cleanupFns) fn();
		for (const m of server.handleListMembers()) {
			try {
				server.handleCancelMember(m.name);
			} catch {}
		}
		httpServer.close();
		restoreHome?.();
	}, 10000);

	it("create member → assign single-turn task → member reaches done/error", async () => {
		// Create a member with minimal tools
		const createRes = await fetch(`${baseUrl}/team/members`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				name: "e2e-worker",
				role: "tester",
				goal: "run a single echo command",
				tools: ["bash"],
			}),
		});
		expect(createRes.status).toBe(200);
		const member = (await createRes.json()) as TeamMember;
		expect(member.status).toBe("idle");

		// Assign a minimal single-turn task
		const taskRes = await fetch(`${baseUrl}/team/tasks`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				title: "echo hello",
				description: "Run: echo hello",
				memberId: member.id,
				priority: "high",
			}),
		});
		expect(taskRes.status).toBe(200);
		const task = (await taskRes.json()) as TeamTask;
		expect(task.status).toBe("in_progress");

		// Poll for member status change (max 60s)
		const deadline = Date.now() + 60_000;
		let finalMember: TeamMember | undefined;
		while (Date.now() < deadline) {
			await new Promise((r) => setTimeout(r, 2000));
			const res = await fetch(`${baseUrl}/team/members/${member.id}`);
			if (res.status === 200) {
				const data = (await res.json()) as { member: TeamMember };
				finalMember = data.member;
				if (finalMember.status === "done" || finalMember.status === "error") break;
			}
		}

		expect(finalMember).toBeDefined();
		expect(["done", "error"]).toContain(finalMember?.status);
	}, 90_000);

	it("SSE event stream delivers team events", async () => {
		const events: unknown[] = [];
		const controller = new AbortController();

		// Subscribe to SSE
		const _ssePromise = fetch(`${baseUrl}/events?streaming=true`, {
			headers: { Accept: "text/event-stream" },
			signal: controller.signal,
		}).then(async (res) => {
			if (!res.body) return;
			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			let buffer = "";
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				const parts = buffer.split("\n\n");
				buffer = parts.pop() ?? "";
				for (const part of parts) {
					const data = part.replace(/^data: /, "").trim();
					if (!data) continue;
					try {
						events.push(JSON.parse(data));
					} catch {
						// skip
					}
				}
			}
		});

		// Give SSE time to connect, then create a member and assign a task
		await new Promise((r) => setTimeout(r, 500));

		const createRes = await fetch(`${baseUrl}/team/members`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				name: "sse-worker",
				role: "tester",
				goal: "echo for SSE test",
				tools: ["bash"],
			}),
		});
		const member = (await createRes.json()) as TeamMember;

		await fetch(`${baseUrl}/team/tasks`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				title: "echo sse",
				description: "Run: echo sse-test",
				memberId: member.id,
			}),
		});

		// Wait for events to arrive
		const deadline = Date.now() + 60_000;
		while (Date.now() < deadline && events.length === 0) {
			await new Promise((r) => setTimeout(r, 1000));
		}

		controller.abort();
		expect(events.length).toBeGreaterThan(0);
	}, 90_000);

	it("JSONL log contains team events", async () => {
		// Log file should exist and contain entries
		const logPath = todayLogPath();
		if (!existsSync(logPath)) {
			// If no log file yet, create a member to trigger logging
			await fetch(`${baseUrl}/team/members`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name: "log-worker",
					role: "tester",
					goal: "trigger log entry",
					tools: ["bash"],
				}),
			});
			await new Promise((r) => setTimeout(r, 1000));
		}

		const entries = readTodayLog();
		expect(entries.length).toBeGreaterThan(0);
		// Should contain team-related events
		const teamEvents = entries.filter(
			(e: { event?: string }) =>
				e.event === "worker_event" ||
				e.event === "member_status_changed" ||
				e.event === "status_snapshot",
		);
		expect(teamEvents.length).toBeGreaterThan(0);
	}, 30_000);
});
