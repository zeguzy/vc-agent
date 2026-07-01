import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import type { AgentSessionEvent } from "../src/agent/session.js";
import type { Message } from "../src/message.js";
import { createHttpServer } from "../src/server/http.js";
import type { AgentServer } from "../src/server/index.js";

type EventHandler = (event: AgentSessionEvent) => void;

function createMockServer(): AgentServer {
	const handlers = new Set<EventHandler>();
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
		handleSetAgentMode: mock((_mode: "standard" | "planner") => {}),
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
		_emit: (event: AgentSessionEvent) => {
			for (const h of handlers) h(event);
		},
	} as unknown as AgentServer & { _emit: (e: AgentSessionEvent) => void };
}

describe("HttpServer", () => {
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

	describe("POST endpoints", () => {
		it("POST /prompt calls handlePrompt", async () => {
			const res = await fetch(`${baseUrl}/prompt`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ text: "hello" }),
			});
			expect(res.status).toBe(200);
			expect(server.handlePrompt).toHaveBeenCalledWith("hello");
		});

		it("POST /abort calls handleAbort", async () => {
			const res = await fetch(`${baseUrl}/abort`, { method: "POST" });
			expect(res.status).toBe(200);
			expect(server.handleAbort).toHaveBeenCalledTimes(1);
		});

		it("POST /compact passes instructions", async () => {
			const res = await fetch(`${baseUrl}/compact`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ instructions: "summarize" }),
			});
			expect(res.status).toBe(200);
			expect(server.handleCompact).toHaveBeenCalledWith("summarize");
		});

		it("POST /session/new returns result", async () => {
			const res = await fetch(`${baseUrl}/session/new`, { method: "POST" });
			const data = await res.json();
			expect(data.cancelled).toBe(false);
		});

		it("POST /session/switch passes path", async () => {
			const res = await fetch(`${baseUrl}/session/switch`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ path: "/tmp/s.jsonl" }),
			});
			expect(res.status).toBe(200);
			expect(server.handleSwitchSession).toHaveBeenCalledWith("/tmp/s.jsonl");
		});

		it("POST /session/name passes name", async () => {
			const res = await fetch(`${baseUrl}/session/name`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "my-session" }),
			});
			expect(res.status).toBe(200);
			expect(server.handleSetSessionName).toHaveBeenCalledWith("my-session");
		});

		it("POST /mode passes mode", async () => {
			const res = await fetch(`${baseUrl}/mode`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ mode: "planner" }),
			});
			expect(res.status).toBe(200);
			expect(server.handleSetAgentMode).toHaveBeenCalledWith("planner");
		});
	});

	describe("GET endpoints", () => {
		it("GET /session/id returns id", async () => {
			const res = await fetch(`${baseUrl}/session/id`);
			const data = await res.json();
			expect(data.id).toBe("session-123");
		});

		it("GET /session/name returns name", async () => {
			const res = await fetch(`${baseUrl}/session/name`);
			const data = await res.json();
			expect(data.name).toBe("test-session");
		});

		it("GET /model returns model info", async () => {
			const res = await fetch(`${baseUrl}/model`);
			const data = await res.json();
			expect(data.model.name).toBe("test-model");
		});

		it("GET /context returns usage", async () => {
			const res = await fetch(`${baseUrl}/context`);
			const data = await res.json();
			expect(data.tokens).toBe(1000);
		});

		it("GET /messages returns array", async () => {
			const res = await fetch(`${baseUrl}/messages`);
			const data = await res.json();
			expect(data.messages).toEqual([]);
		});

		it("GET /sessions returns array", async () => {
			const res = await fetch(`${baseUrl}/sessions`);
			const data = await res.json();
			expect(data.sessions).toEqual([]);
		});

		it("GET /unknown returns 404", async () => {
			const res = await fetch(`${baseUrl}/unknown`);
			expect(res.status).toBe(404);
		});
	});
});
