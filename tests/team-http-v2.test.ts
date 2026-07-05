import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import type { AgentSessionEvent } from "../src/agent/session.js";
import { HttpClient } from "../src/client/http.js";
import type { Message } from "../src/message.js";
import { createHttpServer } from "../src/server/http.js";
import type { AgentServer } from "../src/server/index.js";
import type { MemberState, TaskState } from "../src/teams/types-v2.js";

type EventHandler = (event: AgentSessionEvent) => void;
type TeamEventHandler = (event: unknown) => void;

function createMockServer() {
	const handlers = new Set<EventHandler>();
	const teamHandlers = new Set<TeamEventHandler>();
	const members = new Map<string, MemberState>();
	const tasks = new Map<string, TaskState>();

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

		// V2 member handlers
		handleCreateMember: mock(
			(opts: { name: string; role: string; goal: string; model?: string }) => {
				const member: MemberState = {
					name: opts.name,
					role: opts.role,
					goal: opts.goal,
					model: opts.model,
					status: "idle",
					session: {} as never,
					currentTaskId: null,
				};
				members.set(opts.name, member);
				return Promise.resolve(member);
			},
		),
		handleRemoveMember: mock((name: string) => {
			const m = members.get(name);
			if (m && m.status === "active")
				throw new Error(`member ${name} is currently active — remove not allowed`);
			members.delete(name);
			return Promise.resolve();
		}),
		handleGetMember: mock((name: string) => members.get(name)),
		handleListMembers: mock(() => [...members.values()]),
		handleAssignTask: mock(
			(opts: {
				title: string;
				description: string;
				memberName: string;
				priority?: "high" | "medium" | "low";
			}) => {
				const member = members.get(opts.memberName);
				if (!member) throw new Error(`member ${opts.memberName} not found`);
				member.status = "active";
				const task: TaskState = {
					id: `T${tasks.size + 1}`,
					title: opts.title,
					description: opts.description,
					memberName: opts.memberName,
					priority: opts.priority ?? "medium",
					done: false,
				};
				member.currentTaskId = task.id;
				tasks.set(task.id, task);
				return Promise.resolve(task);
			},
		),
		handleListTasks: mock(() => [...tasks.values()]),
		handleTaskStatus: mock((taskId: string) => tasks.get(taskId)),
		handleSubscribeTeam: mock((handler: TeamEventHandler) => {
			teamHandlers.add(handler);
			return () => teamHandlers.delete(handler);
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
		it("creates a member and returns MemberState JSON", async () => {
			const res = await fetch(`${baseUrl}/team/members`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "explorer", role: "researcher", goal: "find bugs" }),
			});
			expect(res.status).toBe(200);
			const member = (await res.json()) as MemberState;
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
			const data = (await res.json()) as { members: MemberState[] };
			expect(data.members.length).toBeGreaterThanOrEqual(1);
		});
	});

	describe("GET /team/members/:name", () => {
		it("returns member by name", async () => {
			const createRes = await fetch(`${baseUrl}/team/members`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "getter-test", role: "tester", goal: "test get" }),
			});
			const member = (await createRes.json()) as MemberState;
			const res = await fetch(`${baseUrl}/team/members/${member.name}`);
			expect(res.status).toBe(200);
			const data = (await res.json()) as { member: MemberState };
			expect(data.member.name).toBe(member.name);
		});

		it("returns 404 for unknown name", async () => {
			const res = await fetch(`${baseUrl}/team/members/nonexistent`);
			expect(res.status).toBe(404);
		});
	});

	describe("DELETE /team/members/:name", () => {
		it("removes an idle member", async () => {
			const createRes = await fetch(`${baseUrl}/team/members`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "deleteme", role: "temp", goal: "be deleted" }),
			});
			const member = (await createRes.json()) as MemberState;
			const res = await fetch(`${baseUrl}/team/members/${member.name}`, { method: "DELETE" });
			expect(res.status).toBe(200);
		});

		it("returns 400 when trying to remove an active member", async () => {
			const createRes = await fetch(`${baseUrl}/team/members`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "worker1", role: "dev", goal: "work" }),
			});
			const member = (await createRes.json()) as MemberState;
			// Assign a task to make member "active"
			await fetch(`${baseUrl}/team/tasks`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					title: "t1",
					description: "do work",
					memberName: member.name,
				}),
			});
			const res = await fetch(`${baseUrl}/team/members/${member.name}`, { method: "DELETE" });
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
			const member = (await createRes.json()) as MemberState;
			const res = await fetch(`${baseUrl}/team/tasks`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					title: "fix bug",
					description: "fix the bug",
					memberName: member.name,
				}),
			});
			expect(res.status).toBe(200);
			const task = (await res.json()) as TaskState;
			expect(task.title).toBe("fix bug");
			expect(task.memberName).toBe(member.name);
			expect(task.done).toBe(false);
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
			const data = (await res.json()) as { tasks: TaskState[] };
			expect(Array.isArray(data.tasks)).toBe(true);
		});
	});

	describe("GET /team/tasks/:id", () => {
		it("returns 404 for unknown task", async () => {
			const res = await fetch(`${baseUrl}/team/tasks/T_unknown`);
			expect(res.status).toBe(404);
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

	it("removeMember calls DELETE /team/members/:name", async () => {
		const member = await client.createMember({ name: "to-remove", role: "temp", goal: "removed" });
		await client.removeMember(member.name);
		// Should not throw
	});

	it("assignTask calls POST /team/tasks", async () => {
		const member = await client.createMember({ name: "task-http", role: "dev", goal: "code" });
		const task = await client.assignTask({
			title: "http task",
			description: "test task",
			memberName: member.name,
		});
		expect(task.title).toBe("http task");
		expect(task.memberName).toBe(member.name);
	});

	it("fetchMembers calls GET /team/members", async () => {
		const members = await client.fetchMembers();
		expect(Array.isArray(members)).toBe(true);
	});

	it("fetchTasks calls GET /team/tasks", async () => {
		const tasks = await client.fetchTasks();
		expect(Array.isArray(tasks)).toBe(true);
	});

	it("fetchMember returns member or undefined", async () => {
		const member = await client.createMember({ name: "fetch-test", role: "dev", goal: "fetched" });
		const found = await client.fetchMember(member.name);
		expect(found?.name).toBe("fetch-test");
		const notFound = await client.fetchMember("nonexistent");
		expect(notFound).toBeUndefined();
	});

	it("fetchTaskStatus returns task or undefined", async () => {
		const notFound = await client.fetchTaskStatus("T_nonexistent");
		expect(notFound).toBeUndefined();
	});

	it("sync V2 methods throw NotSupportedError", () => {
		expect(() => client.listMembers()).toThrow();
		expect(() => client.getMember("x")).toThrow();
		expect(() => client.listTasks()).toThrow();
		expect(() => client.taskStatus("x")).toThrow();
	});
});
