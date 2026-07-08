/**
 * Black-box HTTP API tests for team member tool/skill assignment.
 *
 * Tests the full HTTP round-trip: POST /team/members → JSON response → verify
 * assignedTools/assignedSkills reflect the request. No internal state access,
 * no LLM — pure API contract verification.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { createRuntime, type RuntimeResult } from "../src/agent/session.js";
import { createHttpServer } from "../src/server/http.js";
import type { AgentServer } from "../src/server/index.js";

let server: AgentServer;
let httpServer: ReturnType<typeof createHttpServer>;
let baseUrl: string;
const testCwd = mkdtempSync(join(tmpdir(), "openagent-bb-"));

beforeAll(async () => {
	const isolatedHome = mkdtempSync(join(tmpdir(), "openagent-bb-home-"));
	mkdirSync(join(isolatedHome, ".config", "openagent"), { recursive: true });
	process.env.HOME = isolatedHome;

	const result: RuntimeResult = await createRuntime({
		cwd: testCwd,
		mode: "new",
		agentMode: "team",
	});

	const { createServer } = await import("../src/server/index.js");
	server = createServer({
		runtime: result.runtime,
		skillManager: result.skillManager,
		cwd: testCwd,
	});

	httpServer = createHttpServer({ server, port: 0, host: "127.0.0.1" });
	const addr = httpServer.address();
	const port = typeof addr === "object" && addr ? addr.port : 0;
	baseUrl = `http://127.0.0.1:${port}`;
}, 30000);

afterEach(() => {
	for (const m of server?.handleListMembers?.() ?? []) {
		try {
			server.handleCancelMember(m.name);
		} catch {}
	}
});

afterAll(() => {
	for (const m of server?.handleListMembers?.() ?? []) {
		try {
			server.handleCancelMember(m.name);
		} catch {}
	}
	try {
		httpServer?.close();
	} catch {}
	try {
		rmSync(testCwd, { recursive: true, force: true });
	} catch {}
});

async function createMember(body: Record<string, unknown>) {
	return fetch(`${baseUrl}/team/members`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
}

async function listMembers() {
	const res = await fetch(`${baseUrl}/team/members`);
	return res.json() as Promise<{ members: any[] }>;
}

async function getMember(name: string) {
	const res = await fetch(`${baseUrl}/team/members/${name}`);
	return { status: res.status, body: await res.json() };
}

async function deleteMember(name: string) {
	const res = await fetch(`${baseUrl}/team/members/${name}`, { method: "DELETE" });
	return { status: res.status, body: await res.json() };
}

describe("Black-box: team member tool/skill assignment", () => {
	it("create member with edit+write tools — response includes assignedTools", async () => {
		const res = await createMember({
			name: "dev-1",
			role: "developer",
			goal: "write code",
			tools: ["read", "bash", "edit", "write", "grep", "find"],
		});
		expect(res.status).toBe(200);
		const member = await res.json();
		expect(member.assignedTools).toBeDefined();
		expect(member.assignedTools).toContain("edit");
		expect(member.assignedTools).toContain("write");
		expect(member.assignedTools).toContain("read");
		expect(member.assignedTools).toContain("bash");
	});

	it("create member without tools — defaults to read-only set", async () => {
		const res = await createMember({
			name: "reader-1",
			role: "reader",
			goal: "read files",
		});
		expect(res.status).toBe(200);
		const member = await res.json();
		expect(member.assignedTools).toBeDefined();
		expect(member.assignedTools).toContain("read");
		expect(member.assignedTools).toContain("bash");
		expect(member.assignedTools).toContain("grep");
		expect(member.assignedTools).toContain("find");
		expect(member.assignedTools).toContain("memory");
		expect(member.assignedTools).toContain("message");
		expect(member.assignedTools).not.toContain("edit");
		expect(member.assignedTools).not.toContain("write");
	});

	it("create member with all custom tools — edit+glob+todo+webfetch", async () => {
		const res = await createMember({
			name: "full-1",
			role: "full-stack",
			goal: "do everything",
			tools: ["read", "bash", "edit", "write", "grep", "find", "glob", "todo", "webfetch"],
		});
		expect(res.status).toBe(200);
		const member = await res.json();
		expect(member.assignedTools).toContain("edit");
		expect(member.assignedTools).toContain("glob");
		expect(member.assignedTools).toContain("todo");
		expect(member.assignedTools).toContain("webfetch");
	});

	it("create member with NEVER_MEMBER_TOOLS — subagent/team/question filtered", async () => {
		const res = await createMember({
			name: "safe-1",
			role: "worker",
			goal: "safe work",
			tools: ["read", "bash", "subagent", "team", "question"],
		});
		expect(res.status).toBe(200);
		const member = await res.json();
		expect(member.assignedTools).not.toContain("subagent");
		expect(member.assignedTools).not.toContain("team");
		expect(member.assignedTools).not.toContain("question");
		expect(member.assignedTools).toContain("read");
		expect(member.assignedTools).toContain("bash");
	});

	it("create member with skills — assignedSkills reflected", async () => {
		mkdirSync(join(testCwd, ".opencode", "skills", "dummy-skill"), { recursive: true });
		writeFileSync(
			join(testCwd, ".opencode", "skills", "dummy-skill", "SKILL.md"),
			"---\nname: dummy-skill\ndescription: A dummy skill for testing\n---\n# Dummy Skill\n",
		);
		const res = await createMember({
			name: "skilled-1",
			role: "specialist",
			goal: "use skills",
			tools: ["read", "bash"],
			skills: ["dummy-skill"],
		});
		expect(res.status).toBe(200);
		const member = await res.json();
		expect(member.assignedSkills).toBeDefined();
		expect(member.assignedSkills).toContain("dummy-skill");
	});

	it("GET /team/members/:name — returns member with assignedTools", async () => {
		await createMember({
			name: "gettest-1",
			role: "tester",
			goal: "test",
			tools: ["read", "bash", "edit", "write"],
		});
		const { status, body } = await getMember("gettest-1");
		expect(status).toBe(200);
		expect(body.member.name).toBe("gettest-1");
		expect(body.member.assignedTools).toContain("edit");
		expect(body.member.assignedTools).toContain("write");
	});

	it("GET /team/members/:name — 404 for unknown member", async () => {
		const { status } = await getMember("nonexistent-member");
		expect(status).toBe(404);
	});

	it("GET /team/members — list contains created members", async () => {
		await createMember({ name: "list-a", role: "a", goal: "a" });
		await createMember({ name: "list-b", role: "b", goal: "b", tools: ["read", "edit"] });
		const data = await listMembers();
		const names = data.members.map((m) => m.name);
		expect(names).toContain("list-a");
		expect(names).toContain("list-b");
		const listB = data.members.find((m) => m.name === "list-b");
		expect(listB?.assignedTools).toContain("edit");
	});

	it("DELETE /team/members/:name — removes member", async () => {
		await createMember({ name: "delete-me", role: "temp", goal: "gone" });
		const { status, body } = await deleteMember("delete-me");
		expect(status).toBe(200);
		expect(body.ok).toBe(true);
		const { status: getStatus } = await getMember("delete-me");
		expect(getStatus).toBe(404);
	});

	it("create member with missing required fields — 400 error", async () => {
		const res = await createMember({ name: "incomplete" });
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error).toBeDefined();
	});

	it("create member with empty name — 400 error", async () => {
		const res = await createMember({ name: "", role: "r", goal: "g" });
		expect(res.status).toBe(400);
	});

	it("default member response has session stripped", async () => {
		const res = await createMember({ name: "strip-test", role: "r", goal: "g" });
		expect(res.status).toBe(200);
		const member = await res.json();
		expect(member.session).toBeUndefined();
	});

	it("member response includes required identity fields", async () => {
		const res = await createMember({
			name: "identity-test",
			role: "code reviewer",
			goal: "review PRs",
			tools: ["read", "bash", "edit"],
		});
		expect(res.status).toBe(200);
		const member = await res.json();
		expect(member.name).toBe("identity-test");
		expect(member.role).toBe("code reviewer");
		expect(member.goal).toBe("review PRs");
		expect(member.status).toBeDefined();
		expect(member.turnCount).toBe(0);
		expect(typeof member.startedAt).toBe("number");
	});
});
