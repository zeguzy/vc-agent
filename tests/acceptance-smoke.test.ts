/**
 * Acceptance Smoke Test — Layer 1 of the harness acceptance pipeline.
 *
 * Uses the project's HttpClient class (src/client/http.ts) to verify the server
 * integration end-to-end through the real client surface, not raw fetch.
 * Skipped by default; enable with `ACCEPTANCE_SMOKE=1`.
 *
 * Does NOT call client.prompt() — it blocks until a full agent turn completes
 * (LLM call + tool loop), consuming tokens. We validate HttpClient cache-fill
 * (init GETs 6 endpoints), session/model/messages accessors, async listSessions,
 * subscribe() SSE API, and abort() endpoint reachability.
 *
 * SSE note: subscribe() returns an Unsubscribe fn and internally connects to
 * /events; the SDK only emits events during an agent turn, which we don't
 * trigger, so we assert the API is callable + connection establishes without
 * throwing — not event delivery.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { HttpClient } from "../src/client/http.js";
import { createHttpServer } from "../src/server/http.js";
import type { AgentServer } from "../src/server/index.js";
import { createRealServer } from "./helpers/real-server.js";

const ENABLED = process.env.ACCEPTANCE_SMOKE === "1";

describe.skipIf(!ENABLED)("Acceptance Smoke via HttpClient", () => {
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

	afterAll(() => {
		httpServer.close();
		restoreHome?.();
	}, 10000);

	it("server binds 127.0.0.1 on a random positive port", () => {
		const address = httpServer.address();
		const port = typeof address === "object" && address ? address.port : 0;
		expect(port).toBeGreaterThan(0);
		expect(baseUrl.startsWith("http://127.0.0.1:")).toBe(true);
	});

	it("HttpClient.init() filled cache from 6 parallel GETs", () => {
		// init() in beforeAll GET /session/id, /session/name, /session/file,
		// /model, /context, /messages — if any returned non-JSON, init throws
		// and the whole suite fails here.
		expect(typeof client.getSessionId()).toBe("string");
		expect(client.getSessionId().length).toBeGreaterThan(0);
	});

	it("HttpClient.getModel() returns model info (cached from GET /model)", () => {
		const model = client.getModel();
		expect(model).toBeDefined();
	});

	it("HttpClient.getMappedMessages() returns array (cached from GET /messages)", () => {
		const messages = client.getMappedMessages();
		expect(Array.isArray(messages)).toBe(true);
	});

	it("HttpClient.listSessions() awaits async GET /sessions and returns array", async () => {
		const sessions = await client.listSessions();
		expect(Array.isArray(sessions)).toBe(true);
	});

	it("HttpClient.subscribe() establishes SSE connection and returns a working Unsubscribe", async () => {
		const events: unknown[] = [];
		const unsubscribe = client.subscribe((event) => {
			events.push(event);
		});
		expect(typeof unsubscribe).toBe("function");
		// Give the internal fetch to /events time to establish the TCP stream.
		await new Promise((r) => setTimeout(r, 300));
		unsubscribe();
		// events.length === 0 is expected: the SDK only emits during agent turn,
		// which we don't trigger. The signal here is that subscribe() is callable
		// via the HttpClient API surface and Unsubscribe cleans up without throwing.
	});

	it("HttpClient.abort() reaches POST /abort without throwing", async () => {
		await client.abort();
		// /prompt is NOT called; abort() validates the /abort route exists via
		// the HttpClient's postJson helper. No agent turn is triggered.
	});
});
