import { describe, expect, it, mock } from "bun:test";
import type { AgentSession, AgentSessionEvent, AgentSessionRuntime } from "../src/agent/session.js";
import { InProcessClient } from "../src/client/in-process.js";
import type { AgentServer } from "../src/server/index.js";
import { createServer } from "../src/server/index.js";

function createMockSession(overrides: Partial<AgentSession> = {}): AgentSession {
	const handlers: ((event: AgentSessionEvent) => void)[] = [];
	return {
		sessionId: "test-session-id",
		sessionFile: "/test/session.jsonl",
		sessionName: undefined,
		model: { name: "test-model", id: "test-model-id" } as any,
		messages: [],
		settingsManager: {} as any,
		modelRegistry: { authStorage: {} } as any,
		prompt: mock(() => Promise.resolve()),
		followUp: mock(() => Promise.resolve()),
		abort: mock(() => Promise.resolve()),
		compact: mock(() => Promise.resolve({})),
		cycleModel: mock(() => Promise.resolve({ model: { name: "next", id: "next-id" } })),
		setActiveToolsByName: mock(),
		setSessionName: mock(),
		getContextUsage: mock(() => ({ tokens: 100, contextWindow: 1000, percent: 10 })),
		subscribe: mock((handler: (event: AgentSessionEvent) => void) => {
			handlers.push(handler);
			return () => {
				const idx = handlers.indexOf(handler);
				if (idx >= 0) handlers.splice(idx, 1);
			};
		}),
		_emit: (event: AgentSessionEvent) => {
			for (const h of handlers) h(event);
		},
		_setMessages: (msgs: any[]) => {
			(mockSession as any).messages = msgs;
		},
		...overrides,
	} as unknown as AgentSession & {
		_emit: (e: AgentSessionEvent) => void;
		_setMessages: (m: any[]) => void;
	};
}

function createMockRuntime(session: AgentSession): AgentSessionRuntime & {
	_triggerRebind: (s: AgentSession) => Promise<void>;
} {
	let rebindHandler: ((s: AgentSession) => Promise<void>) | null = null;
	const runtimeShell: any = {
		session,
		setRebindSession: mock((handler: (s: AgentSession) => Promise<void>) => {
			rebindHandler = handler;
		}),
		newSession: mock(() => Promise.resolve({ cancelled: false })),
		switchSession: mock(() => Promise.resolve({ cancelled: false })),
		_triggerRebind: async (newSession: AgentSession) => {
			runtimeShell.session = newSession;
			if (rebindHandler) await rebindHandler(newSession);
		},
	};
	return runtimeShell;
}

function createTestClient(
	runtime: AgentSessionRuntime,
	skillManager?: unknown,
): { client: InProcessClient; server: AgentServer } {
	const server = createServer({
		runtime,
		skillManager: (skillManager ?? {}) as never,
		cwd: "/test",
	});
	const client = new InProcessClient(server);
	return { client, server };
}

describe("InProcessClient", () => {
	it("delegates prompt to session.prompt", async () => {
		const mockSession = createMockSession();
		const runtime = createMockRuntime(mockSession);
		const { client } = createTestClient(runtime);

		await client.prompt("hello world");

		expect(mockSession.prompt).toHaveBeenCalledTimes(1);
		expect(mockSession.prompt).toHaveBeenCalledWith("hello world");
	});

	it("delegates followUp to session.followUp", async () => {
		const mockSession = createMockSession();
		const runtime = createMockRuntime(mockSession);
		const { client } = createTestClient(runtime);

		await client.followUp("queued message");

		expect(mockSession.followUp).toHaveBeenCalledWith("queued message");
	});

	it("delegates abort to session.abort", async () => {
		const mockSession = createMockSession();
		const runtime = createMockRuntime(mockSession);
		const { client } = createTestClient(runtime);

		await client.abort();

		expect(mockSession.abort).toHaveBeenCalledTimes(1);
	});

	it("delegates compact to session.compact", async () => {
		const mockSession = createMockSession();
		const runtime = createMockRuntime(mockSession);
		const { client } = createTestClient(runtime);

		await client.compact("focus on auth");

		expect(mockSession.compact).toHaveBeenCalledWith("focus on auth");
	});

	it("delegates newSession to runtime.newSession", async () => {
		const mockSession = createMockSession();
		const runtime = createMockRuntime(mockSession);
		const { client } = createTestClient(runtime);

		const result = await client.newSession();

		expect(runtime.newSession).toHaveBeenCalledTimes(1);
		expect(result.cancelled).toBe(false);
	});

	it("delegates switchSession to runtime.switchSession", async () => {
		const mockSession = createMockSession();
		const runtime = createMockRuntime(mockSession);
		const { client } = createTestClient(runtime);

		await client.switchSession("/path/to/session.jsonl");

		expect(runtime.switchSession).toHaveBeenCalledWith("/path/to/session.jsonl");
	});

	it("delegates setSessionName to session.setSessionName", () => {
		const mockSession = createMockSession();
		const runtime = createMockRuntime(mockSession);
		const { client } = createTestClient(runtime);

		client.setSessionName("my task");

		expect(mockSession.setSessionName).toHaveBeenCalledWith("my task");
	});

	it("returns sessionName from getSessionName", () => {
		const mockSession = createMockSession({ sessionName: "named-session" } as any);
		const runtime = createMockRuntime(mockSession);
		const { client } = createTestClient(runtime);

		expect(client.getSessionName()).toBe("named-session");
	});

	it("returns sessionId from getSessionId", () => {
		const mockSession = createMockSession();
		const runtime = createMockRuntime(mockSession);
		const { client } = createTestClient(runtime);

		expect(client.getSessionId()).toBe("test-session-id");
	});

	it("returns sessionFile from getSessionFile", () => {
		const mockSession = createMockSession();
		const runtime = createMockRuntime(mockSession);
		const { client } = createTestClient(runtime);

		expect(client.getSessionFile()).toBe("/test/session.jsonl");
	});

	it("returns model info from getModel", () => {
		const mockSession = createMockSession();
		const runtime = createMockRuntime(mockSession);
		const { client } = createTestClient(runtime);

		const model = client.getModel();
		expect(model).toEqual({ name: "test-model", id: "test-model-id" });
	});

	it("returns undefined from getModel when no model", () => {
		const mockSession = createMockSession({ model: undefined } as any);
		const runtime = createMockRuntime(mockSession);
		const { client } = createTestClient(runtime);

		expect(client.getModel()).toBeUndefined();
	});

	it("returns context usage from getContextUsage", () => {
		const mockSession = createMockSession();
		const runtime = createMockRuntime(mockSession);
		const { client } = createTestClient(runtime);

		const usage = client.getContextUsage();
		expect(usage).toEqual({ tokens: 100, contextWindow: 1000, percent: 10 });
	});

	it("delegates setActiveToolsByName to session", () => {
		const mockSession = createMockSession();
		const runtime = createMockRuntime(mockSession);
		const { client } = createTestClient(runtime);

		client.setActiveToolsByName(["read", "bash"]);

		expect(mockSession.setActiveToolsByName).toHaveBeenCalledWith(["read", "bash"]);
	});

	it("delegates cycleModel to session", async () => {
		const mockSession = createMockSession();
		const runtime = createMockRuntime(mockSession);
		const { client } = createTestClient(runtime);

		const result = await client.cycleModel();

		expect(mockSession.cycleModel).toHaveBeenCalledTimes(1);
		expect(result).toEqual({ model: { name: "next", id: "next-id" } });
	});
});

describe("InProcessClient — event forwarding", () => {
	it("forwards events from session to subscribed handlers", () => {
		const mockSession = createMockSession();
		const runtime = createMockRuntime(mockSession);
		const { client } = createTestClient(runtime);

		const received: AgentSessionEvent[] = [];
		client.subscribe((event) => received.push(event));

		const fakeEvent = { type: "agent_start" } as AgentSessionEvent;
		mockSession._emit(fakeEvent);

		expect(received).toHaveLength(1);
		expect(received[0]).toBe(fakeEvent);
	});

	it("supports multiple subscribers", () => {
		const mockSession = createMockSession();
		const runtime = createMockRuntime(mockSession);
		const { client } = createTestClient(runtime);

		let count1 = 0;
		let count2 = 0;
		client.subscribe(() => count1++);
		client.subscribe(() => count2++);

		mockSession._emit({ type: "message_start", message: { role: "assistant" } } as any);

		expect(count1).toBe(1);
		expect(count2).toBe(1);
	});

	it("unsubscribe stops receiving events", () => {
		const mockSession = createMockSession();
		const runtime = createMockRuntime(mockSession);
		const { client } = createTestClient(runtime);

		let count = 0;
		const unsub = client.subscribe(() => count++);

		mockSession._emit({ type: "agent_start" } as any);
		expect(count).toBe(1);

		unsub();
		mockSession._emit({ type: "agent_end" } as any);
		expect(count).toBe(1);
	});

	it("does not forward events after unsubscribe even with multiple subscribers", () => {
		const mockSession = createMockSession();
		const runtime = createMockRuntime(mockSession);
		const { client } = createTestClient(runtime);

		let alive = 0;
		let dead = 0;
		client.subscribe(() => alive++);
		const unsub = client.subscribe(() => dead++);

		mockSession._emit({ type: "agent_start" } as any);
		expect(alive).toBe(1);
		expect(dead).toBe(1);

		unsub();
		mockSession._emit({ type: "agent_end" } as any);
		expect(alive).toBe(2);
		expect(dead).toBe(1);
	});
});

describe("InProcessClient — session hot-switch", () => {
	it("fires onSessionChange when runtime triggers rebind", async () => {
		const mockSession = createMockSession();
		const runtime = createMockRuntime(mockSession);
		const { client } = createTestClient(runtime);

		let changeCount = 0;
		client.onSessionChange(async () => {
			changeCount++;
		});

		const newSession = createMockSession({ sessionId: "new-session" } as any);
		await runtime._triggerRebind(newSession);

		expect(changeCount).toBe(1);
	});

	it("passes the new session to onSessionChange handler", async () => {
		const mockSession = createMockSession();
		const runtime = createMockRuntime(mockSession);
		const { client } = createTestClient(runtime);

		let receivedSession: AgentSession | null = null;
		client.onSessionChange(async (s) => {
			receivedSession = s;
		});

		const newSession = createMockSession({ sessionId: "switched-id" } as any);
		await runtime._triggerRebind(newSession);

		expect(receivedSession).not.toBeNull();
		expect(receivedSession?.sessionId).toBe("switched-id");
	});

	it("fires multiple onSessionChange handlers", async () => {
		const mockSession = createMockSession();
		const runtime = createMockRuntime(mockSession);
		const { client } = createTestClient(runtime);

		let count1 = 0;
		let count2 = 0;
		client.onSessionChange(async () => count1++);
		client.onSessionChange(async () => count2++);

		await runtime._triggerRebind(createMockSession() as any);

		expect(count1).toBe(1);
		expect(count2).toBe(1);
	});

	it("re-subscribes to events on the new session after hot-switch", async () => {
		const oldSession = createMockSession();
		const runtime = createMockRuntime(oldSession);
		const { client } = createTestClient(runtime);

		const received: string[] = [];
		client.subscribe((event) => {
			received.push(event.type);
		});

		const newSession = createMockSession({ sessionId: "after-switch" } as any);
		await runtime._triggerRebind(newSession);

		newSession._emit({ type: "agent_start" } as any);

		expect(received).toContain("agent_start");
		expect(oldSession.subscribe).toHaveBeenCalledTimes(1);
		expect(newSession.subscribe).toHaveBeenCalledTimes(1);
	});

	it("does not receive events from old session after hot-switch", async () => {
		const oldSession = createMockSession();
		const runtime = createMockRuntime(oldSession);
		const { client } = createTestClient(runtime);

		let count = 0;
		client.subscribe(() => count++);

		const newSession = createMockSession() as any;
		await runtime._triggerRebind(newSession);

		oldSession._emit({ type: "agent_start" } as any);
		newSession._emit({ type: "message_start", message: { role: "assistant" } } as any);

		expect(count).toBe(1);
	});
});

describe("InProcessClient — service accessors", () => {
	it("returns skillManager from getSkillManager", () => {
		const mockSession = createMockSession();
		const runtime = createMockRuntime(mockSession);
		const fakeSkillManager = { listSkills: () => {} } as any;
		const { client } = createTestClient(runtime, fakeSkillManager);

		expect(client.getSkillManager()).toBe(fakeSkillManager);
	});

	it("returns settingsManager from getSettingsManager", () => {
		const fakeSettings = { get: () => {} } as any;
		const mockSession = createMockSession({ settingsManager: fakeSettings } as any);
		const runtime = createMockRuntime(mockSession);
		const { client } = createTestClient(runtime);

		expect(client.getSettingsManager()).toBe(fakeSettings);
	});

	it("returns modelRegistry from getModelRegistry", () => {
		const fakeRegistry = { authStorage: { hasAuth: () => false } } as any;
		const mockSession = createMockSession({ modelRegistry: fakeRegistry } as any);
		const runtime = createMockRuntime(mockSession);
		const { client } = createTestClient(runtime);

		expect(client.getModelRegistry()).toBe(fakeRegistry);
	});

	it("returns authStorage from getAuthStorage via modelRegistry", () => {
		const fakeAuth = { hasAuth: () => true } as any;
		const fakeRegistry = { authStorage: fakeAuth } as any;
		const mockSession = createMockSession({ modelRegistry: fakeRegistry } as any);
		const runtime = createMockRuntime(mockSession);
		const { client } = createTestClient(runtime);

		expect(client.getAuthStorage()).toBe(fakeAuth);
	});

	it("exposes runtime via getRuntime", () => {
		const mockSession = createMockSession();
		const runtime = createMockRuntime(mockSession);
		const { client } = createTestClient(runtime);

		expect(client.getRuntime()).toBe(runtime);
	});

	it("exposes session via getSession", () => {
		const mockSession = createMockSession();
		const runtime = createMockRuntime(mockSession);
		const { client } = createTestClient(runtime);

		expect(client.getSession()).toBe(mockSession);
	});
});

describe("createClient factory", () => {
	it("creates an InProcessClient instance", async () => {
		const { createClient } = await import("../src/client/index.js");
		const mockSession = createMockSession();
		const runtime = createMockRuntime(mockSession);
		const server = createServer({ runtime, skillManager: {} as never, cwd: "/test" });
		const client = createClient(server);

		expect(client).toBeInstanceOf(InProcessClient);
		expect(client.getSessionId()).toBe("test-session-id");
	});
});
