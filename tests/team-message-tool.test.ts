import { describe, expect, it } from "bun:test";
import type {
	DeliveryMode,
	MemberMessage,
	MemberName,
	MemberState,
	ReadInboxOptions,
	TeamManagerLike,
} from "../src/teams/types-v2.js";
import { BROADCAST_RECIPIENT as BROADCAST } from "../src/teams/types-v2.js";
import { createMessageTool } from "../src/tools/message.js";

interface MockSession {
	isStreaming: boolean;
	steered: string[];
	prompted: string[];
	status: MemberState["status"];
}

function makeMockSession(status: MemberState["status"] = "active"): MockSession {
	return {
		isStreaming: false,
		steered: [],
		prompted: [],
		status,
	};
}

function makeMemberState(name: string, status: MemberState["status"] = "active"): MemberState {
	const session = makeMockSession(status) as unknown as MemberState["session"];
	return {
		name,
		role: "tester",
		goal: "test",
		status,
		session,
		currentTaskId: null,
		lastTaskPrompt: null,
	};
}

class CapturingManager implements TeamManagerLike {
	members = new Map<MemberName, MemberState>();
	inboxes = new Map<MemberName, MemberMessage[]>();
	sendCalls: Array<{ from: string; to: string; content: string }> = [];
	broadcastCalls: Array<{ from: string; content: string }> = [];

	sendMessage(opts: { from: MemberName; to: MemberName; content: string }): {
		message: MemberMessage;
		delivery: DeliveryMode;
	} {
		this.sendCalls.push(opts);
		const recipient = this.members.get(opts.to);
		const message: MemberMessage = {
			id: `msg_test${this.sendCalls.length}`,
			from: opts.from,
			to: opts.to,
			content: opts.content,
			timestamp: Date.now(),
			read: false,
		};
		const inbox = this.inboxes.get(opts.to) ?? [];
		inbox.push(message);
		this.inboxes.set(opts.to, inbox);
		const delivery: DeliveryMode = recipient?.status === "active" ? "steer" : "persist-only";
		return { message, delivery };
	}

	broadcastMessage(opts: { from: MemberName; content: string }): Array<{
		message: MemberMessage;
		delivery: DeliveryMode;
	}> {
		this.broadcastCalls.push(opts);
		const results: Array<{ message: MemberMessage; delivery: DeliveryMode }> = [];
		for (const member of this.members.values()) {
			if (member.name === opts.from) continue;
			const message: MemberMessage = {
				id: `msg_b${results.length}`,
				from: opts.from,
				to: BROADCAST,
				content: opts.content,
				timestamp: Date.now(),
				read: false,
			};
			const inbox = this.inboxes.get(member.name) ?? [];
			inbox.push(message);
			this.inboxes.set(member.name, inbox);
			results.push({
				message,
				delivery: member.status === "active" ? "steer" : "persist-only",
			});
		}
		return results;
	}

	readInbox(name: MemberName, opts?: ReadInboxOptions): MemberMessage[] {
		const all = this.inboxes.get(name) ?? [];
		let filtered = all;
		if (opts?.from) filtered = filtered.filter((m) => m.from === opts.from);
		if (opts?.unreadOnly) filtered = filtered.filter((m) => !m.read);
		return filtered;
	}

	markInboxRead(name: MemberName, ids?: string[]): number {
		const all = this.inboxes.get(name) ?? [];
		const idSet = ids ? new Set(ids) : null;
		let count = 0;
		const updated = all.map((m) => {
			if (m.read) return m;
			if (idSet && !idSet.has(m.id)) return m;
			count++;
			return { ...m, read: true };
		});
		this.inboxes.set(name, updated);
		return count;
	}

	listMembers(): MemberState[] {
		return [...this.members.values()];
	}
	listTasks(): [] {
		return [];
	}
	getMaxWorkers(): number {
		return 4;
	}
	isSelfMember(): boolean {
		return false;
	}
	getSelfMemberName(): undefined {
		return undefined;
	}
	subscribe(): () => void {
		return () => {};
	}
	async createMember(): Promise<MemberState> {
		throw new Error("not used");
	}
	async removeMember(): Promise<void> {
		throw new Error("not used");
	}
	getMember(): undefined {
		return undefined;
	}
	assignTask(): never {
		throw new Error("not used");
	}
	completeTask(): void {}
	writeMemory(): void {}
	readMemberIndex(): null {
		return null;
	}
	readTopicFile(): null {
		return null;
	}
	readTeamMd(): never {
		throw new Error("not used");
	}
	pauseMember(): void {}
	resumeMember(): void {}
	cancelMember(): void {}
	directMember(): void {}
	async dispose(): Promise<void> {}
}

async function runTool(
	manager: CapturingManager,
	selfName: string | undefined,
	params: Record<string, unknown>,
): Promise<{ text: string; isError?: boolean }> {
	const tool = createMessageTool({ teamRef: { current: manager }, selfName });
	const result = await tool.execute(
		"test-id",
		params,
		undefined as never,
		undefined as never,
		undefined as never,
	);
	const text = result.content[0]?.text ?? "";
	return { text, isError: result.isError };
}

describe("message tool", () => {
	it("send requires to and content", async () => {
		const m = new CapturingManager();
		const r1 = await runTool(m, "alice", { action: "send", content: "hi" });
		expect(r1.isError).toBe(true);
		expect(r1.text).toContain("to is required");

		const r2 = await runTool(m, "alice", { action: "send", to: "bob" });
		expect(r2.isError).toBe(true);
		expect(r2.text).toContain("content is required");
	});

	it("send delivers via manager.sendMessage with from=selfName", async () => {
		const m = new CapturingManager();
		m.members.set("bob", makeMemberState("bob"));
		const r = await runTool(m, "alice", {
			action: "send",
			to: "bob",
			content: "hey bob",
		});
		expect(r.isError).not.toBe(true);
		expect(m.sendCalls.length).toBe(1);
		expect(m.sendCalls[0]).toEqual({ from: "alice", to: "bob", content: "hey bob" });
		expect(r.text).toContain("Sent to @bob");
	});

	it("send falls back to 'leader' when selfName is undefined", async () => {
		const m = new CapturingManager();
		m.members.set("bob", makeMemberState("bob"));
		await runTool(m, undefined, { action: "send", to: "bob", content: "lead-msg" });
		expect(m.sendCalls[0]?.from).toBe("leader");
	});

	it("broadcast requires content", async () => {
		const m = new CapturingManager();
		const r = await runTool(m, "alice", { action: "broadcast" });
		expect(r.isError).toBe(true);
		expect(r.text).toContain("content is required");
	});

	it("broadcast delivers to all members except self", async () => {
		const m = new CapturingManager();
		m.members.set("alice", makeMemberState("alice"));
		m.members.set("bob", makeMemberState("bob"));
		m.members.set("carol", makeMemberState("carol"));
		const r = await runTool(m, "alice", { action: "broadcast", content: "team!" });
		expect(r.isError).not.toBe(true);
		expect(m.broadcastCalls.length).toBe(1);
		expect(m.inboxes.get("bob")?.length).toBe(1);
		expect(m.inboxes.get("carol")?.length).toBe(1);
		expect(m.inboxes.get("alice")?.length ?? 0).toBe(0);
	});

	it("read returns formatted inbox entries", async () => {
		const m = new CapturingManager();
		m.members.set("alice", makeMemberState("alice"));
		m.inboxes.set("alice", [
			{
				id: "msg_x1",
				from: "bob",
				to: "alice",
				content: "hello",
				timestamp: new Date("2025-01-01T00:00:00Z").getTime(),
				read: false,
			},
		]);
		const r = await runTool(m, "alice", { action: "read" });
		expect(r.text).toContain("@bob");
		expect(r.text).toContain("hello");
		expect(r.text).toContain("msg_x1");
	});

	it("read empty inbox returns friendly message", async () => {
		const m = new CapturingManager();
		m.members.set("alice", makeMemberState("alice"));
		m.inboxes.set("alice", []);
		const r = await runTool(m, "alice", { action: "read" });
		expect(r.text).toContain("Inbox is empty");
	});

	it("mark-read delegates to manager.markInboxRead", async () => {
		const m = new CapturingManager();
		m.members.set("alice", makeMemberState("alice"));
		m.inboxes.set("alice", [
			{
				id: "msg_a",
				from: "bob",
				to: "alice",
				content: "x",
				timestamp: Date.now(),
				read: false,
			},
			{
				id: "msg_b",
				from: "carol",
				to: "alice",
				content: "y",
				timestamp: Date.now(),
				read: false,
			},
		]);
		const r = await runTool(m, "alice", { action: "mark-read", ids: ["msg_a"] });
		expect(r.text).toContain("Marked 1 message");
		expect(m.inboxes.get("alice")?.[0]?.read).toBe(true);
		expect(m.inboxes.get("alice")?.[1]?.read).toBe(false);
	});

	it("unknown action returns error", async () => {
		const m = new CapturingManager();
		const r = await runTool(m, "alice", { action: "bogus" });
		expect(r.isError).toBe(true);
		expect(r.text).toContain("Unknown action: bogus");
	});
});
