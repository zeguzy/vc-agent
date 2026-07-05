import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import type { AgentSessionEvent } from "../src/agent/session.js";
import { HttpClient } from "../src/client/http.js";
import type { Message } from "../src/message.js";
import { createHttpServer } from "../src/server/http.js";
import type { AgentServer } from "../src/server/index.js";
import type { MemberState, TaskState } from "../src/teams/types-v2.js";

type EventHandler = (event: AgentSessionEvent) => void;
type TeamEventHandler = (event: unknown) => void;

function createMockServer(): AgentServer & { _emit: (e: AgentSessionEvent) => void } {
	const handlers = new Set<EventHandler>();
	const teamHandlers = new Set<TeamEventHandler>();
	return {
		handlePrompt: mock((_text: string) => Promise.resolve()),
		handleFollowUp: mock((_text: string) => Promise.resolve()),
		handleAbort: mock(() => Promise.resolve()),
		handleCompact: mock((_instructions?: string) => Promise.resolve({ ok: true })),
		handleNewSession: mock(() => Promise.resolve({ cancelled: false })),
		handleSwitchSession: mock((_path: string) => Promise.resolve({ cancelled: false })),
		handleSetSessionName: mock((_name: string) => {}),
		handleGetSessionName: mock(() => "remote-session"),
		handleGetSessionId: mock(() => "remote-123"),
		handleGetSessionFile: mock(() => "/remote/session.jsonl"),
		handleGetModel: mock(() => ({ name: "remote-model", id: "remote-id" })),
		handleGetContextUsage: mock(() => ({ tokens: 500, contextWindow: 4000, percent: 12.5 })),
		handleGetMappedMessages: mock(() => [{ id: "1", role: "user", content: "hi" }] as Message[]),
		handleCycleModel: mock(() => Promise.resolve(undefined)),
		handleSetActiveToolsByName: mock((_tools: string[]) => {}),
		handleSetAgentMode: mock((_mode: "standard" | "planner" | "team" | "orchestrator") => {}),
		handleListSessions: mock(() => Promise.resolve([{ path: "/a.jsonl", name: "a", modified: 0 }])),
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
		handleSubscribeTeam: mock((handler: TeamEventHandler) => {
			teamHandlers.add(handler);
			return () => teamHandlers.delete(handler);
		}),
		handleCreateMember: mock((_opts: { name: string; role: string; goal: string; model?: string }) =>
			Promise.resolve({} as MemberState),
		),
		handleRemoveMember: mock((_name: string) => Promise.resolve()),
		handleGetMember: mock((_name: string) => undefined as MemberState | undefined),
		handleListMembers: mock(() => [] as MemberState[]),
		handleAssignTask: mock(
			(_opts: { title: string; description: string; memberName: string; priority?: string }) =>
				Promise.resolve({} as TaskState),
		),
		handleListTasks: mock(() => [] as TaskState[]),
		handleTaskStatus: mock((_id: string) => undefined as TaskState | undefined),
		_emit: (event: AgentSessionEvent) => {
			for (const h of handlers) h(event);
		},
	} as unknown as AgentServer & { _emit: (e: AgentSessionEvent) => void };
}

describe("HttpClient", () => {
	let mockServer: ReturnType<typeof createMockServer>;
	let httpServer: ReturnType<typeof createHttpServer>;
	let client: HttpClient;
	let baseUrl: string;

	beforeAll(async () => {
		mockServer = createMockServer();
		httpServer = createHttpServer({ server: mockServer, port: 0 });
		const address = httpServer.address();
		const port = typeof address === "object" && address ? address.port : 0;
		baseUrl = `http://localhost:${port}`;
		client = new HttpClient(baseUrl);
		await client.init();
	});

	afterAll(() => {
		httpServer.close();
	});

	describe("cached sync getters (after init)", () => {
		it("returns sessionId from cache", () => {
			expect(client.getSessionId()).toBe("remote-123");
		});

		it("returns sessionName from cache", () => {
			expect(client.getSessionName()).toBe("remote-session");
		});

		it("returns sessionFile from cache", () => {
			expect(client.getSessionFile()).toBe("/remote/session.jsonl");
		});

		it("returns model from cache", () => {
			expect(client.getModel()?.name).toBe("remote-model");
		});

		it("returns contextUsage from cache", () => {
			expect(client.getContextUsage()?.tokens).toBe(500);
		});

		it("returns messages from cache", () => {
			expect(client.getMappedMessages()).toHaveLength(1);
		});
	});

	describe("async methods", () => {
		it("prompt calls server", async () => {
			await client.prompt("test prompt");
			expect(mockServer.handlePrompt).toHaveBeenCalledWith("test prompt");
		});

		it("abort calls server", async () => {
			await client.abort();
			expect(mockServer.handleAbort).toHaveBeenCalledTimes(1);
		});

		it("newSession returns result", async () => {
			const result = await client.newSession();
			expect(result.cancelled).toBe(false);
		});

		it("listSessions returns sessions", async () => {
			const sessions = await client.listSessions();
			expect(sessions).toHaveLength(1);
		});

		it("setSessionName updates cache", () => {
			client.setSessionName("new-name");
			expect(client.getSessionName()).toBe("new-name");
		});

		it("setAgentMode calls server", async () => {
			client.setAgentMode("planner");
			await new Promise((r) => setTimeout(r, 50));
			expect(mockServer.handleSetAgentMode).toHaveBeenCalledWith("planner");
		});
	});

	describe("@internal methods throw", () => {
		it("getSettingsManager throws", () => {
			expect(() => client.getSettingsManager()).toThrow();
		});

		it("getModelRegistry throws", () => {
			expect(() => client.getModelRegistry()).toThrow();
		});

		it("getSession throws", () => {
			expect(() => client.getSession()).toThrow();
		});

		it("executeCommand throws", async () => {
			expect(client.executeCommand("test", "", {} as never)).rejects.toThrow();
		});
	});

	describe("subscribe via SSE", () => {
		it("receives events from server", async () => {
			const received: string[] = [];
			const unsub = client.subscribe((event) => {
				received.push(event.type);
			});

			await new Promise((r) => setTimeout(r, 50));

			mockServer._emit({ type: "agent_start" } as AgentSessionEvent);
			await new Promise((r) => setTimeout(r, 50));

			expect(received).toContain("agent_start");
			unsub();
		});
	});
});
