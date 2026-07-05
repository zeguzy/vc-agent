import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import type { AgentSessionEvent } from "../src/agent/session.js";
import { HttpClient } from "../src/client/http.js";
import type { Message } from "../src/message.js";
import { createHttpServer } from "../src/server/http.js";
import type { AgentServer } from "../src/server/index.js";
import type { MemberId, TeamMember, TeamMessage, TeamTask } from "../src/teams/types.js";

type EventHandler = (event: AgentSessionEvent) => void;
type TeamEventHandler = (event: unknown) => void;

function createMockServer() {
	const handlers = new Set<EventHandler>();
	const teamHandlers = new Set<TeamEventHandler>();
	const members = new Map<MemberId, TeamMember>();
	const tasks = new Map<string, TeamTask>();
	const messages: TeamMessage[] = [];

	function addMember(m: TeamMember) {
		members.set(m.id, m);
	}
	function removeMember(id: MemberId) {
		const m = members.get(id);
		if (m && m.status === "working")
			throw new Error(`member ${id} is currently working — cancel first`);
		members.delete(id);
	}

	return {
		handlePrompt: mock((_text: string) => Promise.resolve()),
		handleFollowUp: mock((_text: string) => Promise.resolve()),
		handleAbort: mock(() => Promise.resolve()),
		handleCompact: mock((_instructions?: string) => Promise.resolve()),
		handleNewSession: mock(() => Promise.resolve({ cancelled: false })),
		handleSwitchSession: mock((_path: string) => Promise.resolve({ cancelled: false })),
		handleSetSessionName: mock((_name: string) => {}),
		handleGetSessionName: mock(() => "test-session"),
		handleGetSessionId: mock(() => "session-123"),
		handleGetSessionFile: mock(() => "/tmp/session.jsonl"),
		handleGetModel: mock(() => ({ name: "test-model", id: "test-id" })),
		handleGetContextUsage: mock(() => ({ tokens: 1000, contextWindow: 8000, percent: 12.5 })),
		handleGetMappedMessages: mock(() => [] as Message[]),
		handleCycleModel: mock(() => Promise.resolve(undefined)),
		handleSetActiveToolsByName: mock((_tools: string[]) => {}),
		handleSetAgentMode: mock((_mode: "standard" | "planner" | "team" | "orchestrator") => {}),
		handleListSessions: mock(() => Promise.resolve([])),
		handleSubscribe: mock((handler: EventHandler) => {
			handlers.add(handler);
			return () => handlers.delete(handler);
		}),
		handleOnSessionChange: mock(() => {}),
		handleGetSettingsManager: mock(() => ({}) as never),
		handleGetModelRegistry: mock(() => ({}) as never),
		handleGetAuthStorage: mock(() => ({}) as never),
		handleGetSkillManager: mock(() => ({}) as never),
		handleGetSession: mock(() => ({}) as never),
		handleGetRuntime: mock(() => ({}) as never),
		handleExecuteCommand: mock(async () => true),
		handleListWorkers: mock(() => []),
		handleGetWorker: mock(() => undefined),
		handleSpawnWorker: mock(async () => ({ workerId: "wkr_test1", status: "running" as const })),
		handleCancelWorker: mock(async () => {}),
		handleCancelAllWorkers: mock(async () => {}),
		handleSubscribeTeam: mock((handler: TeamEventHandler) => {
			teamHandlers.add(handler);
			return () => teamHandlers.delete(handler);
		}),

		// V2 handlers with in-memory state
		handleCreateMember: mock(
			(opts: {
				name: string;
				role: string;
				goal: string;
				model?: string;
				tools?: string[];
				systemPrompt?: string;
			}) => {
				const id = `mem_test${members.size + 1}`;
				const member: TeamMember = {
					id,
					name: opts.name,
					role: opts.role,
					goal: opts.goal,
					status: "idle",
					model: opts.model ?? "default",
					tools: opts.tools,
					systemPrompt: opts.systemPrompt,
					context: [],
					turnCount: 0,
					inputTokens: 0,
					outputTokens: 0,
					cost: 0,
					lastSummary: null,
					lastError: null,
					createdAt: Date.now(),
				};
				addMember(member);
				return Promise.resolve(member);
			},
		),
		handleRemoveMember: mock((id: MemberId) => {
			removeMember(id);
			return Promise.resolve();
		}),
		handleGetMember: mock((id: MemberId) => members.get(id)),
		handleListMembers: mock(() => [...members.values()]),
		handleAssignTask: mock(
			(opts: {
				title: string;
				description: string;
				memberId: MemberId;
				priority?: "high" | "medium" | "low";
			}) => {
				const member = members.get(opts.memberId);
				if (!member) throw new Error(`member ${opts.memberId} not found`);
				member.status = "working";
				const task: TeamTask = {
					id: `task_test${tasks.size + 1}`,
					title: opts.title,
					description: opts.description,
					assignedTo: opts.memberId,
					status: "in_progress",
					priority: opts.priority ?? "medium",
				};
				tasks.set(task.id, task);
				return Promise.resolve(task);
			},
		),
		handleListTasks: mock(() => [...tasks.values()]),
		handleTaskStatus: mock((taskId: string) => tasks.get(taskId)),
		handleSendMessage: mock((from: MemberId, to: MemberId | "team", content: string) => {
			if (!members.has(from)) throw new Error(`sender ${from} not found`);
			if (to !== "team" && !members.has(to)) throw new Error(`recipient ${to} not found`);
			messages.push({
				id: `msg_test${messages.length + 1}`,
				from,
				to,
				content,
				timestamp: Date.now(),
			});
			return Promise.resolve();
		}),
		handleReadInbox: mock((memberId?: MemberId) => {
			if (memberId) {
				return messages.filter((m) => m.to === memberId || m.to === "team" || m.from === memberId);
			}
			return [...messages];
		}),

		_emit: (event: AgentSessionEvent) => {
			for (const h of handlers) h(event);
		},
		_emitTeam: (event: unknown) => {
			for (const h of teamHandlers) h(event);
		},
	} as unknown as AgentServer & {
		_emit: (e: AgentSessionEvent) => void;
		_emitTeam: (e: unknown) => void;
	};
}

describe("Team V2 HTTP API", () => {
	let server: ReturnType<typeof createMockServer>;
	let httpServer: ReturnType<typeof createHttpServer>;
	let baseUrl: string;

	beforeAll(() => {
		server = createMockServer();
		httpServer = createHttpServer({ server, port: 0 });
		const address = httpServer.address();
		const port = typeof address === "object" && address ? address.port : 0;
		baseUrl = `http://localhost:${port}`;
	});

	afterAll(() => {
		httpServer.close();
	});

	describe("POST /team/members", () => {
		it("creates a member and returns TeamMember JSON", async () => {
			const res = await fetch(`${baseUrl}/team/members`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "explorer", role: "researcher", goal: "find bugs" }),
			});
			expect(res.status).toBe(200);
			const member = (await res.json()) as TeamMember;
			expect(member.name).toBe("explorer");
			expect(member.role).toBe("researcher");
			expect(member.status).toBe("idle");
		});

		it("returns 400 if required fields missing", async () => {
			const res = await fetch(`${baseUrl}/team/members`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "no-role" }),
			});
			expect(res.status).toBe(400);
		});
	});

	describe("GET /team/members", () => {
		it("returns members list", async () => {
			const res = await fetch(`${baseUrl}/team/members`);
			expect(res.status).toBe(200);
			const data = (await res.json()) as { members: TeamMember[] };
			expect(data.members.length).toBeGreaterThanOrEqual(1);
		});
	});

	describe("GET /team/members/:id", () => {
		it("returns member by id", async () => {
			const createRes = await fetch(`${baseUrl}/team/members`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "getter-test", role: "tester", goal: "test get" }),
			});
			const member = (await createRes.json()) as TeamMember;
			const res = await fetch(`${baseUrl}/team/members/${member.id}`);
			expect(res.status).toBe(200);
			const data = (await res.json()) as { member: TeamMember };
			expect(data.member.id).toBe(member.id);
		});

		it("returns 404 for unknown id", async () => {
			const res = await fetch(`${baseUrl}/team/members/mem_unknown`);
			expect(res.status).toBe(404);
		});
	});

	describe("DELETE /team/members/:id", () => {
		it("removes an idle member", async () => {
			const createRes = await fetch(`${baseUrl}/team/members`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "deleteme", role: "temp", goal: "be deleted" }),
			});
			const member = (await createRes.json()) as TeamMember;
			const res = await fetch(`${baseUrl}/team/members/${member.id}`, { method: "DELETE" });
			expect(res.status).toBe(200);
		});

		it("returns 400 when trying to remove a working member", async () => {
			const createRes = await fetch(`${baseUrl}/team/members`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "worker1", role: "dev", goal: "work" }),
			});
			const member = (await createRes.json()) as TeamMember;
			// Assign a task to make member "working"
			await fetch(`${baseUrl}/team/tasks`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ title: "t1", description: "do work", memberId: member.id }),
			});
			const res = await fetch(`${baseUrl}/team/members/${member.id}`, { method: "DELETE" });
			expect(res.status).toBe(400);
		});
	});

	describe("POST /team/tasks", () => {
		it("assigns a task to a member", async () => {
			const createRes = await fetch(`${baseUrl}/team/members`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "task-worker", role: "dev", goal: "code" }),
			});
			const member = (await createRes.json()) as TeamMember;
			const res = await fetch(`${baseUrl}/team/tasks`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ title: "fix bug", description: "fix the bug", memberId: member.id }),
			});
			expect(res.status).toBe(200);
			const task = (await res.json()) as TeamTask;
			expect(task.title).toBe("fix bug");
			expect(task.status).toBe("in_progress");
			expect(task.assignedTo).toBe(member.id);
		});

		it("returns 400 for missing fields", async () => {
			const res = await fetch(`${baseUrl}/team/tasks`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ title: "no member" }),
			});
			expect(res.status).toBe(400);
		});
	});

	describe("GET /team/tasks", () => {
		it("returns tasks list", async () => {
			const res = await fetch(`${baseUrl}/team/tasks`);
			expect(res.status).toBe(200);
			const data = (await res.json()) as { tasks: TeamTask[] };
			expect(Array.isArray(data.tasks)).toBe(true);
		});
	});

	describe("GET /team/tasks/:id", () => {
		it("returns 404 for unknown task", async () => {
			const res = await fetch(`${baseUrl}/team/tasks/task_unknown`);
			expect(res.status).toBe(404);
		});
	});

	describe("POST /team/messages", () => {
		it("sends a message between members", async () => {
			const r1 = await fetch(`${baseUrl}/team/members`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "alice", role: "lead", goal: "lead" }),
			});
			const r2 = await fetch(`${baseUrl}/team/members`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "bob", role: "dev", goal: "code" }),
			});
			const alice = (await r1.json()) as TeamMember;
			const bob = (await r2.json()) as TeamMember;

			const res = await fetch(`${baseUrl}/team/messages`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ from: alice.id, to: bob.id, content: "hello bob" }),
			});
			expect(res.status).toBe(200);
		});

		it("returns 400 for missing fields", async () => {
			const res = await fetch(`${baseUrl}/team/messages`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ from: "x" }),
			});
			expect(res.status).toBe(400);
		});
	});

	describe("GET /team/inbox", () => {
		it("returns all messages without memberId", async () => {
			const res = await fetch(`${baseUrl}/team/inbox`);
			expect(res.status).toBe(200);
			const data = (await res.json()) as { messages: TeamMessage[] };
			expect(Array.isArray(data.messages)).toBe(true);
		});

		it("returns filtered messages with memberId", async () => {
			const res = await fetch(`${baseUrl}/team/inbox?memberId=mem_test1`);
			expect(res.status).toBe(200);
			const data = (await res.json()) as { messages: TeamMessage[] };
			expect(Array.isArray(data.messages)).toBe(true);
		});
	});

	describe("POST /mode with team/orchestrator", () => {
		it("accepts team mode", async () => {
			const res = await fetch(`${baseUrl}/mode`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ mode: "team" }),
			});
			expect(res.status).toBe(200);
			expect(server.handleSetAgentMode).toHaveBeenCalledWith("team");
		});

		it("accepts orchestrator mode", async () => {
			const res = await fetch(`${baseUrl}/mode`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ mode: "orchestrator" }),
			});
			expect(res.status).toBe(200);
			expect(server.handleSetAgentMode).toHaveBeenCalledWith("orchestrator");
		});
	});
});

describe("HttpClient V2 methods", () => {
	let mockServer: ReturnType<typeof createMockServer>;
	let httpServer: ReturnType<typeof createHttpServer>;
	let client: HttpClient;

	beforeAll(async () => {
		mockServer = createMockServer();
		httpServer = createHttpServer({ server: mockServer, port: 0 });
		const address = httpServer.address();
		const port = typeof address === "object" && address ? address.port : 0;
		const baseUrl = `http://localhost:${port}`;
		client = new HttpClient(baseUrl);
		await client.init();
	});

	afterAll(() => {
		httpServer.close();
	});

	it("createMember calls POST /team/members", async () => {
		const member = await client.createMember({
			name: "http-test",
			role: "tester",
			goal: "test http",
		});
		expect(member.name).toBe("http-test");
		expect(member.status).toBe("idle");
	});

	it("removeMember calls DELETE /team/members/:id", async () => {
		const member = await client.createMember({ name: "to-remove", role: "temp", goal: "removed" });
		await client.removeMember(member.id);
		// Should not throw
	});

	it("assignTask calls POST /team/tasks", async () => {
		const member = await client.createMember({ name: "task-http", role: "dev", goal: "code" });
		const task = await client.assignTask({
			title: "http task",
			description: "test task",
			memberId: member.id,
		});
		expect(task.title).toBe("http task");
		expect(task.status).toBe("in_progress");
	});

	it("sendMessage calls POST /team/messages", async () => {
		const m1 = await client.createMember({ name: "sender", role: "dev", goal: "send" });
		const m2 = await client.createMember({ name: "receiver", role: "dev", goal: "receive" });
		await client.sendMessage(m1.id, m2.id, "hello from http");
		// Should not throw
	});

	it("fetchMembers calls GET /team/members", async () => {
		const members = await client.fetchMembers();
		expect(Array.isArray(members)).toBe(true);
	});

	it("fetchTasks calls GET /team/tasks", async () => {
		const tasks = await client.fetchTasks();
		expect(Array.isArray(tasks)).toBe(true);
	});

	it("fetchInbox calls GET /team/inbox", async () => {
		const messages = await client.fetchInbox();
		expect(Array.isArray(messages)).toBe(true);
	});

	it("fetchMember returns member or undefined", async () => {
		const member = await client.createMember({ name: "fetch-test", role: "dev", goal: "fetched" });
		const found = await client.fetchMember(member.id);
		expect(found?.name).toBe("fetch-test");
		const notFound = await client.fetchMember("mem_nonexistent");
		expect(notFound).toBeUndefined();
	});

	it("fetchTaskStatus returns task or undefined", async () => {
		const notFound = await client.fetchTaskStatus("task_nonexistent");
		expect(notFound).toBeUndefined();
	});

	it("sync V2 methods throw NotSupportedError", () => {
		expect(() => client.listMembers()).toThrow();
		expect(() => client.getMember("x")).toThrow();
		expect(() => client.listTasks()).toThrow();
		expect(() => client.taskStatus("x")).toThrow();
		expect(() => client.readInbox()).toThrow();
	});
});
