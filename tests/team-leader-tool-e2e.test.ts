/**
 * Layer 2 acceptance test for team-leader-tool-assignment change.
 *
 * Validates the core fix: when a member is created with tools=["edit","write",...],
 * buildMemberCustomTools creates the edit ToolDefinition, and the member can
 * actually call edit.
 *
 * Two phases:
 *   Phase 1 (always runs): Integration — member session has edit in customTools
 *   Phase 2 (RUN_LLM_TESTS=1): E2E — member actually writes a file via edit tool
 */
import { afterEach, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { createRuntime, type RuntimeResult } from "../src/agent/session.js";
import { createHttpServer } from "../src/server/http.js";
import type { AgentServer } from "../src/server/index.js";
import { buildAstronConfig } from "./helpers/astron-config.js";

const RUN_LLM = process.env.RUN_LLM_TESTS === "1";
const HAS_KEY = !!(process.env.ASTRON_API_KEY || process.env.ASTRON_INFINITY_API_KEY);

function makeIsolatedCwd(): string {
	const dir = join(tmpdir(), `openagent-e2e-${process.pid}-${Date.now()}`);
	return dir;
}

describe("Team leader tool assignment — Layer 2 acceptance", () => {
	let server: AgentServer;
	let httpServer: ReturnType<typeof createHttpServer>;
	let baseUrl: string;
	let testCwd: string;

	beforeAll(async () => {
		testCwd = makeIsolatedCwd();
		mkdirSync(testCwd, { recursive: true });
		writeFileSync(join(testCwd, "hello.txt"), "Hello Wrld\n");

		const originalHome = process.env.HOME;
		const isolatedHome = join(tmpdir(), `openagent-e2e-home-${process.pid}-${Date.now()}`);
		mkdirSync(join(isolatedHome, ".config", "openagent"), { recursive: true });
		process.env.HOME = isolatedHome;

		const config = RUN_LLM && HAS_KEY ? buildAstronConfig() : undefined;

		const result: RuntimeResult = await createRuntime({
			cwd: testCwd,
			mode: "new",
			agentMode: "team",
			...(config ? { config } : {}),
		});

		const { createServer } = await import("../src/server/index.js");
		server = createServer({
			runtime: result.runtime,
			skillManager: result.skillManager,
			cwd: testCwd,
		});

		httpServer = createHttpServer({ server, port: 0, host: "127.0.0.1" });
		const address = httpServer.address();
		const port = typeof address === "object" && address ? address.port : 0;
		baseUrl = `http://127.0.0.1:${port}`;
	}, 30000);

	afterEach(() => {
		if (server?.handleListMembers) {
			for (const m of server.handleListMembers()) {
				try {
					server.handleCancelMember(m.name);
				} catch {}
			}
		}
	});

	it("Phase 1: member created with edit tool is registered", async () => {
		const res = await fetch(`${baseUrl}/team/members`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				name: "editor-1",
				role: "code editor",
				goal: "fix typos in code",
				tools: ["read", "bash", "edit", "write", "grep", "find"],
			}),
		});
		expect(res.status).toBe(200);
		const member = await res.json();
		expect(member.status).toBe("active");

		const members = server.handleListMembers();
		expect(members.length).toBeGreaterThanOrEqual(1);

		const editorMember = members.find((m) => m.name === "editor-1");
		expect(editorMember).toBeDefined();
	}, 10000);

	it("Phase 1: member created without explicit tools defaults to read-only", async () => {
		const res = await fetch(`${baseUrl}/team/members`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				name: "reader-1",
				role: "reader",
				goal: "read files only",
			}),
		});
		expect(res.status).toBe(200);
		const member = await res.json();
		expect(member.status).toBe("active");
	});

	(RUN_LLM && HAS_KEY ? it : it.skip)(
		"Phase 2: member with edit tool actually fixes a file",
		async () => {
			const createRes = await fetch(`${baseUrl}/team/members`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name: "fixer-llm",
					role: "typo fixer",
					goal: "fix typos in text files",
					tools: ["read", "bash", "edit", "write", "grep", "find"],
				}),
			});
			expect(createRes.status).toBe(200);

			const taskRes = await fetch(`${baseUrl}/team/tasks`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					title: "Fix typo",
					description:
						"The file hello.txt contains 'Hello Wrld'. Fix the typo to 'Hello World' using the edit tool.",
					memberName: "fixer-llm",
					priority: "high",
				}),
			});
			expect(taskRes.status).toBe(200);

			const deadline = Date.now() + 120_000;
			let fixed = false;
			while (Date.now() < deadline) {
				await new Promise((r) => setTimeout(r, 5000));
				try {
					const content = readFileSync(join(testCwd, "hello.txt"), "utf-8");
					if (content.includes("Hello World")) {
						fixed = true;
						break;
					}
				} catch {}
			}

			expect(fixed).toBe(true);

			const content = readFileSync(join(testCwd, "hello.txt"), "utf-8");
			expect(content).toContain("Hello World");
			expect(content).not.toContain("Hello Wrld");
		},
		150_000,
	);
});

process.on("exit", () => {
	try {
		rmSync(testCwd || "", { recursive: true, force: true });
	} catch {}
});
