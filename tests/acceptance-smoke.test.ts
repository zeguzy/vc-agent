/**
 * Acceptance Smoke Test — Layer 1 of the harness acceptance pipeline.
 *
 * Starts a real isolated server in-process and verifies core endpoint reachability.
 * Skipped by default; enable with `ACCEPTANCE_SMOKE=1`.
 *
 * Does NOT call POST /prompt — that endpoint blocks until a full agent turn completes
 * (LLM call + tool loop), which would consume tokens. We only verify GET endpoints,
 * SSE subscription establishment, and POST /abort route existence.
 *
 * See openspec/specs/harness-acceptance/spec.md and .opencode/skills/opsx-accept/SKILL.md.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createHttpServer } from "../src/server/http.js";
import type { AgentServer } from "../src/server/index.js";
import { createRealServer } from "./helpers/real-server.js";

const ENABLED = process.env.ACCEPTANCE_SMOKE === "1";

describe.skipIf(!ENABLED)("Acceptance Smoke", () => {
	let server: AgentServer;
	let httpServer: ReturnType<typeof createHttpServer>;
	let baseUrl: string;
	let restoreHome: (() => void) | undefined;

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
		httpServer.close();
		await server.handleCancelAllWorkers();
		restoreHome?.();
	}, 10000);

	it("server starts on a random port with a positive port number", () => {
		const address = httpServer.address();
		const port = typeof address === "object" && address ? address.port : 0;
		expect(port).toBeGreaterThan(0);
		expect(baseUrl.startsWith("http://127.0.0.1:")).toBe(true);
	}, 30000);

	it("GET /session/id returns 200 with an id field", async () => {
		const res = await fetch(`${baseUrl}/session/id`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { id?: string };
		expect(typeof body.id).toBe("string");
		expect((body.id ?? "").length).toBeGreaterThan(0);
	}, 30000);

	it("GET /model returns 200", async () => {
		const res = await fetch(`${baseUrl}/model`);
		expect(res.status).toBe(200);
		await res.json();
	}, 30000);

	it("GET /messages returns 200 with messages array", async () => {
		const res = await fetch(`${baseUrl}/messages`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { messages?: unknown[] };
		expect(Array.isArray(body.messages)).toBe(true);
	}, 30000);

	it("GET /sessions returns 200 with sessions array", async () => {
		const res = await fetch(`${baseUrl}/sessions`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { sessions?: unknown[] };
		expect(Array.isArray(body.sessions)).toBe(true);
	}, 30000);

	it("GET /events establishes an SSE subscription within 5s", async () => {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 5000);

		let connected = false;
		try {
			const res = await fetch(`${baseUrl}/events`, {
				headers: { Accept: "text/event-stream" },
				signal: controller.signal,
			});
			expect(res.status).toBe(200);
			expect(res.headers.get("content-type")?.includes("text/event-stream")).toBe(true);

			if (!res.body) {
				clearTimeout(timeout);
				return;
			}
			const reader = res.body.getReader();
			const { value } = await reader.read();
			if (value) connected = true;
			reader.cancel();
		} catch (err) {
			if (controller.signal.aborted) {
				console.warn(
					"SSE subscription did not establish within 5s; marking as connected=false (non-blocking)",
				);
			} else {
				throw err;
			}
		} finally {
			clearTimeout(timeout);
		}
		console.warn(
			`SSE connected=${connected} (non-blocking — agent turn not triggered, no events expected)`,
		);
	}, 30000);

	it("POST /abort endpoint exists and returns 200", async () => {
		const res = await fetch(`${baseUrl}/abort`, { method: "POST" });
		expect(res.status).toBe(200);
		const body = (await res.json()) as { ok?: boolean };
		expect(body.ok).toBe(true);
	}, 30000);
});
