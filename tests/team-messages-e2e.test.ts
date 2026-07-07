import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { createHttpServer } from "../src/server/http.js";
import type { AgentServer } from "../src/server/index.js";
import { TeamManager } from "../src/teams/manager-v2.js";
import { MemberInbox } from "../src/teams/messages.js";
import { DEFAULT_TEAM_CONFIG, resolveTeamConfig } from "../src/teams/types.js";
import type { TeamEvent } from "../src/teams/types-v2.js";

const LOG_DIR = join(homedir(), ".config", "openagent", "logs", "teams");

function todayLogPath(): string {
	const date = new Date().toISOString().slice(0, 10);
	return join(LOG_DIR, `${date}.jsonl`);
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

function fakeSession(): AgentSession {
	return {
		isStreaming: false,
		messages: [],
		steer() {
			return Promise.resolve();
		},
		prompt() {
			return Promise.resolve();
		},
		subscribe() {
			return () => {};
		},
		dispose() {},
		abort() {},
	} as unknown as AgentSession;
}

interface TestServer {
	server: AgentServer;
	httpServer: Server;
	baseUrl: string;
	manager: TeamManager;
	cleanup: () => void;
	events: TeamEvent[];
}

function startTestServer(): TestServer {
	const tmpDir = mkdtempSync(join(tmpdir(), "tm-e2e-"));
	const config = resolveTeamConfig({
		...DEFAULT_TEAM_CONFIG,
		messageHistoryLimit: 50,
		messageRateLimitPerMinute: 10,
	});
	const manager = new TeamManager(config, {} as never, tmpDir, join(tmpDir, "team"));
	const events: TeamEvent[] = [];
	manager.subscribe((e) => events.push(e));

	// Mock AgentServer that delegates only the team-message surface.
	const mockServer: AgentServer = {
		handleSendMessage: (opts) => manager.sendMessage(opts),
		handleBroadcastMessage: (opts) => manager.broadcastMessage(opts),
		handleReadInbox: (name, opts) => manager.readInbox(name, opts),
		handleMarkInboxRead: (name, ids) => manager.markInboxRead(name, ids),
	} as unknown as AgentServer;

	const httpServer = createHttpServer({ server: mockServer, port: 0 });
	const address = httpServer.address();
	const port = typeof address === "object" && address ? address.port : 0;
	const baseUrl = `http://localhost:${port}`;

	const cleanup = () => {
		httpServer.close();
		rmSync(tmpDir, { recursive: true, force: true });
	};

	return { server: mockServer, httpServer, baseUrl, manager, cleanup, events };
}

function injectMember(manager: TeamManager, name: string, status: "active" | "idle" = "active") {
	// @ts-expect-error: test fixture reaches into private state
	manager.members.set(name, {
		name,
		role: "tester",
		goal: "g",
		status,
		session: fakeSession(),
		currentTaskId: null,
		lastTaskPrompt: null,
	});
	// @ts-expect-error
	manager.inboxes.set(
		name,
		// @ts-expect-error
		new MemberInbox(manager.files.paths.memberTopics(name), 50),
	);
}

async function postJson(baseUrl: string, path: string, body: unknown): Promise<unknown> {
	const res = await fetch(`${baseUrl}${path}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	return res.json();
}

async function getJson(baseUrl: string, path: string): Promise<unknown> {
	const res = await fetch(`${baseUrl}${path}`);
	return res.json();
}

describe("Team member messaging HTTP e2e", () => {
	let testServer: TestServer;

	beforeAll(() => {
		testServer = startTestServer();
	});

	afterAll(() => {
		testServer.cleanup();
	});

	it("POST /team/messages delivers and persists", async () => {
		injectMember(testServer.manager, "alice", "active");
		injectMember(testServer.manager, "bob", "active");
		const result = (await postJson(testServer.baseUrl, "/team/messages", {
			from: "bob",
			to: "alice",
			content: "via http",
		})) as { message: { id: string; from: string; to: string }; delivery: string };
		expect(result.message.from).toBe("bob");
		expect(result.message.to).toBe("alice");
		expect(typeof result.message.id).toBe("string");
		expect(result.delivery).toBe("steer");
	});

	it("POST /team/messages rejects missing fields with 400", async () => {
		const res = await fetch(`${testServer.baseUrl}/team/messages`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ from: "x" }),
		});
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: string };
		expect(body.error).toContain("required");
	});

	it("POST /team/messages/broadcast fans out", async () => {
		injectMember(testServer.manager, "carol", "active");
		injectMember(testServer.manager, "dave", "active");
		injectMember(testServer.manager, "erin", "active");
		const result = (await postJson(testServer.baseUrl, "/team/messages/broadcast", {
			from: "carol",
			content: "team via http",
		})) as { results: Array<{ delivery: string }> };
		expect(result.results.length).toBeGreaterThanOrEqual(2);
		for (const r of result.results) {
			expect(r.delivery).toBe("steer");
		}
		const daveInbox = (await getJson(testServer.baseUrl, "/team/inbox?member=dave")) as {
			messages: Array<{ content: string }>;
		};
		const erinInbox = (await getJson(testServer.baseUrl, "/team/inbox?member=erin")) as {
			messages: Array<{ content: string }>;
		};
		const carolInbox = (await getJson(testServer.baseUrl, "/team/inbox?member=carol")) as {
			messages: unknown[];
		};
		expect(daveInbox.messages.some((m) => m.content === "team via http")).toBe(true);
		expect(erinInbox.messages.some((m) => m.content === "team via http")).toBe(true);
		expect(carolInbox.messages.some((m) => m === null)).toBe(false);
	});

	it("GET /team/inbox returns messages for member", async () => {
		const data = (await getJson(testServer.baseUrl, "/team/inbox?member=alice")) as {
			messages: Array<{ from: string; content: string }>;
		};
		expect(data.messages.length).toBeGreaterThan(0);
		expect(data.messages.some((m) => m.content === "via http")).toBe(true);
	});

	it("GET /team/inbox filters by from", async () => {
		const data = (await getJson(testServer.baseUrl, "/team/inbox?member=alice&from=ghost")) as {
			messages: unknown[];
		};
		expect(data.messages.length).toBe(0);
	});

	it("GET /team/inbox requires member param", async () => {
		const res = await fetch(`${testServer.baseUrl}/team/inbox`);
		expect(res.status).toBe(400);
	});

	it("POST /team/inbox/read marks messages", async () => {
		const before = (await getJson(
			testServer.baseUrl,
			"/team/inbox?member=alice&unreadOnly=true",
		)) as { messages: Array<{ id: string }> };
		expect(before.messages.length).toBeGreaterThan(0);
		const ids = before.messages.map((m) => m.id);
		const result = (await postJson(testServer.baseUrl, "/team/inbox/read", {
			member: "alice",
			ids,
		})) as { count: number };
		expect(result.count).toBe(ids.length);
		const after = (await getJson(
			testServer.baseUrl,
			"/team/inbox?member=alice&unreadOnly=true",
		)) as { messages: unknown[] };
		expect(after.messages.length).toBe(0);
	});

	it("JSONL log captures member_message_sent events", async () => {
		const beforeCount = readTodayLog().filter((e) => e.event === "member_message_sent").length;
		injectMember(testServer.manager, "frank", "active");
		injectMember(testServer.manager, "grace", "active");
		await postJson(testServer.baseUrl, "/team/messages", {
			from: "frank",
			to: "grace",
			content: "log-test",
		});
		// Give appendFileSync time to flush
		await new Promise((r) => setTimeout(r, 50));
		const entries = readTodayLog().filter((e) => e.event === "member_message_sent");
		expect(entries.length).toBeGreaterThan(beforeCount);
		const last = entries[entries.length - 1];
		expect(last.from).toBe("frank");
		expect(last.to).toBe("grace");
		expect(typeof last.messageId).toBe("string");
		expect(last.delivery).toBe("steer");
	});

	it("JSONL log captures member_message_delivered events", async () => {
		const beforeCount = readTodayLog().filter((e) => e.event === "member_message_delivered").length;
		injectMember(testServer.manager, "heidi", "active");
		injectMember(testServer.manager, "ivan", "active");
		await postJson(testServer.baseUrl, "/team/messages", {
			from: "heidi",
			to: "ivan",
			content: "delivery-log-test",
		});
		await new Promise((r) => setTimeout(r, 50));
		const entries = readTodayLog().filter((e) => e.event === "member_message_delivered");
		expect(entries.length).toBeGreaterThan(beforeCount);
	});

	it("JSONL log captures member_message_read events", async () => {
		const beforeCount = readTodayLog().filter((e) => e.event === "member_message_read").length;
		injectMember(testServer.manager, "judy", "active");
		injectMember(testServer.manager, "kim", "active");
		await postJson(testServer.baseUrl, "/team/messages", {
			from: "kim",
			to: "judy",
			content: "read-log-test",
		});
		const inbox = (await getJson(testServer.baseUrl, "/team/inbox?member=judy")) as {
			messages: Array<{ id: string }>;
		};
		await postJson(testServer.baseUrl, "/team/inbox/read", {
			member: "judy",
			ids: inbox.messages.map((m) => m.id),
		});
		await new Promise((r) => setTimeout(r, 50));
		const entries = readTodayLog().filter((e) => e.event === "member_message_read");
		expect(entries.length).toBeGreaterThan(beforeCount);
		const last = entries[entries.length - 1];
		expect(last.by).toBe("judy");
		expect(typeof last.count).toBe("number");
	});

	it("team events stream includes member_message_sent", async () => {
		const before = testServer.events.filter((e) => e.type === "member_message_sent").length;
		injectMember(testServer.manager, "leo", "active");
		injectMember(testServer.manager, "mallory", "active");
		await postJson(testServer.baseUrl, "/team/messages", {
			from: "leo",
			to: "mallory",
			content: "events-test",
		});
		const after = testServer.events.filter((e) => e.type === "member_message_sent").length;
		expect(after).toBeGreaterThan(before);
	});
});
