import { describe, expect, it } from "bun:test";
import type { AgentConfig } from "../src/agents/types.js";
import {
	classifyEventForTest,
	deniedToolsFor,
	resolveTools,
	WORKER_NEVER_INJECTED_TOOLS,
} from "../src/teams/worker.js";

function makeAgent(overrides: Partial<AgentConfig> = {}): AgentConfig {
	return {
		name: "test-worker",
		description: "test",
		systemPrompt: "",
		source: "project",
		filePath: "/tmp/test.md",
		...overrides,
	};
}

describe("deniedToolsFor", () => {
	it("denies edit/write for default mode", () => {
		expect(deniedToolsFor("default")).toEqual(["edit", "write"]);
	});

	it("denies edit/write/bash for plan mode", () => {
		expect(deniedToolsFor("plan")).toEqual(["edit", "write", "bash"]);
	});

	it("denies nothing for acceptEdits mode", () => {
		expect(deniedToolsFor("acceptEdits")).toEqual([]);
	});

	it("denies nothing when mode is undefined", () => {
		expect(deniedToolsFor(undefined)).toEqual([]);
	});
});

describe("resolveTools", () => {
	it("uses BUILTIN_TOOLS when agent.tools is undefined", () => {
		const tools = resolveTools(makeAgent(), []);
		expect(tools).toEqual(["read", "bash", "write", "grep", "find"]);
	});

	it("applies disallowedTools from frontmatter", () => {
		const agent = makeAgent({ tools: ["read", "write", "bash"], disallowedTools: ["write"] });
		expect(resolveTools(agent, [])).toEqual(["read", "bash"]);
	});

	it("applies permission-default deny on top of disallowedTools", () => {
		const agent = makeAgent({
			tools: ["read", "write", "edit", "bash"],
			permissionMode: "default",
		});
		expect(resolveTools(agent, deniedToolsFor("default"))).toEqual(["read", "bash"]);
	});

	it("applies plan deny (edit/write/bash) on top", () => {
		const agent = makeAgent({
			tools: ["read", "write", "edit", "bash"],
			permissionMode: "plan",
		});
		expect(resolveTools(agent, deniedToolsFor("plan"))).toEqual(["read"]);
	});

	it("removes question and LSP tools, warns once per tool", () => {
		const agent = makeAgent({
			tools: ["read", "question", "lsp_diagnostics", "lsp", "lsp_diagnostics"],
		});
		const tools = resolveTools(agent, []);
		expect(tools).toEqual(["read"]);
	});

	it("does not add an undefined agent.disallowedTools entry", () => {
		const agent = makeAgent({ tools: ["read", "bash"] });
		expect(resolveTools(agent, ["write"])).toEqual(["read", "bash"]);
	});

	it("deduplicates never-injected warnings across repeated entries", () => {
		const warned: string[] = [];
		const orig = console.error;
		console.error = (msg: string) => warned.push(msg);
		try {
			const agent = makeAgent({
				tools: ["read", "lsp", "lsp", "question", "question"],
			});
			resolveTools(agent, []);
			const lspWarnings = warned.filter((m) => m.includes('"lsp"'));
			const questionWarnings = warned.filter((m) => m.includes('"question"'));
			expect(lspWarnings).toHaveLength(1);
			expect(questionWarnings).toHaveLength(1);
		} finally {
			console.error = orig;
		}
	});
});

describe("WORKER_NEVER_INJECTED_TOOLS", () => {
	it("contains question and all lsp-prefixed tools", () => {
		expect(WORKER_NEVER_INJECTED_TOOLS.has("question")).toBe(true);
		expect(WORKER_NEVER_INJECTED_TOOLS.has("lsp")).toBe(true);
		expect(WORKER_NEVER_INJECTED_TOOLS.has("lsp_diagnostics")).toBe(true);
		expect(WORKER_NEVER_INJECTED_TOOLS.has("lsp_goto_definition")).toBe(true);
		expect(WORKER_NEVER_INJECTED_TOOLS.has("lsp_find_references")).toBe(true);
		expect(WORKER_NEVER_INJECTED_TOOLS.has("lsp_rename")).toBe(true);
	});
});

describe("classifyEventForTest", () => {
	it("returns null for unknown event types", () => {
		const event = { type: "unknown_event" } as unknown as Parameters<
			typeof classifyEventForTest
		>[0];
		expect(classifyEventForTest(event)).toBeNull();
	});

	it("classifies message_update as message_delta", () => {
		const event = { type: "message_update" } as unknown as Parameters<
			typeof classifyEventForTest
		>[0];
		expect(classifyEventForTest(event)).toBe("message_delta");
	});

	it("classifies tool_execution_start as tool_call", () => {
		const event = { type: "tool_execution_start" } as unknown as Parameters<
			typeof classifyEventForTest
		>[0];
		expect(classifyEventForTest(event)).toBe("tool_call");
	});

	it("classifies tool_execution_end as tool_result", () => {
		const event = { type: "tool_execution_end" } as unknown as Parameters<
			typeof classifyEventForTest
		>[0];
		expect(classifyEventForTest(event)).toBe("tool_result");
	});

	it("classifies agent_end directly", () => {
		const event = { type: "agent_end" } as unknown as Parameters<typeof classifyEventForTest>[0];
		expect(classifyEventForTest(event)).toBe("agent_end");
	});

	it("classifies assistant message_end as message_end", () => {
		const event = {
			type: "message_end",
			message: { role: "assistant" },
		} as unknown as Parameters<typeof classifyEventForTest>[0];
		expect(classifyEventForTest(event)).toBe("message_end");
	});

	it("returns null for non-assistant message_end", () => {
		const event = {
			type: "message_end",
			message: { role: "user" },
		} as unknown as Parameters<typeof classifyEventForTest>[0];
		expect(classifyEventForTest(event)).toBeNull();
	});
});
