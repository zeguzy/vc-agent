import { afterEach, describe, expect, it, mock } from "bun:test";
import type { AgentSessionEvent } from "../src/agent/session.js";
import { resolveNotificationsConfig } from "../src/notifications/config.js";
import { isSshSession } from "../src/notifications/guard.js";
import { NotificationRouter } from "../src/notifications/notifier.js";
import type { NotificationPayload } from "../src/notifications/types.js";

describe("resolveNotificationsConfig", () => {
	it("returns all-on defaults when input is undefined", () => {
		const cfg = resolveNotificationsConfig(undefined);
		expect(cfg.enabled).toBe(true);
		expect(cfg.sound).toBe(true);
		expect(cfg.bashThresholdMs).toBe(10_000);
		expect(cfg.events).toEqual({
			agentEnd: true,
			toolError: true,
			longBash: true,
			needsInput: true,
			compactionEnd: true,
		});
		expect(cfg.channels).toEqual({ toast: true, osc: true, os: true });
	});

	it("respects enabled:false master switch", () => {
		const cfg = resolveNotificationsConfig({ enabled: false });
		expect(cfg.enabled).toBe(false);
	});

	it("merges partial event flags with defaults", () => {
		const cfg = resolveNotificationsConfig({ events: { agentEnd: false } });
		expect(cfg.events.agentEnd).toBe(false);
		expect(cfg.events.toolError).toBe(true);
		expect(cfg.events.needsInput).toBe(true);
	});

	it("merges partial channel flags with defaults", () => {
		const cfg = resolveNotificationsConfig({ channels: { os: false } });
		expect(cfg.channels.os).toBe(false);
		expect(cfg.channels.osc).toBe(true);
		expect(cfg.channels.toast).toBe(true);
	});

	it("honors custom bashThresholdMs", () => {
		const cfg = resolveNotificationsConfig({ bashThresholdMs: 5000 });
		expect(cfg.bashThresholdMs).toBe(5000);
	});
});

describe("isSshSession", () => {
	const originalConnection = process.env.SSH_CONNECTION;
	const originalTty = process.env.SSH_TTY;

	afterEach(() => {
		if (originalConnection === undefined) delete process.env.SSH_CONNECTION;
		else process.env.SSH_CONNECTION = originalConnection;
		if (originalTty === undefined) delete process.env.SSH_TTY;
		else process.env.SSH_TTY = originalTty;
	});

	it("returns false when no SSH env vars set", () => {
		delete process.env.SSH_CONNECTION;
		delete process.env.SSH_TTY;
		expect(isSshSession()).toBe(false);
	});

	it("returns true when SSH_CONNECTION is set", () => {
		process.env.SSH_CONNECTION = "1.2.3.4 22 5.6.7.8 22";
		delete process.env.SSH_TTY;
		expect(isSshSession()).toBe(true);
	});

	it("returns true when SSH_TTY is set", () => {
		delete process.env.SSH_CONNECTION;
		process.env.SSH_TTY = "/dev/pts/0";
		expect(isSshSession()).toBe(true);
	});
});

function makeRouter(opts: { config?: Record<string, unknown> }): {
	router: NotificationRouter;
	toasts: NotificationPayload[];
} {
	const toasts: NotificationPayload[] = [];
	const router = new NotificationRouter({
		// Disable OSC + OS channels in tests to avoid spawning real binaries.
		config: { channels: { osc: false, os: false }, ...(opts.config ?? {}) },
		onToast: (p) => toasts.push(p),
	});
	return { router, toasts };
}

function event(partial: { type: string } & Record<string, unknown>): AgentSessionEvent {
	return partial as unknown as AgentSessionEvent;
}

describe("NotificationRouter.handleEvent", () => {
	it("fires toast on agent_end", async () => {
		const { router, toasts } = makeRouter({});
		await router.handleEvent(event({ type: "agent_end" }));
		expect(toasts).toHaveLength(1);
		expect(toasts[0].event).toBe("agentEnd");
	});

	it("fires toast on tool_execution_end with isError", async () => {
		const { router, toasts } = makeRouter({});
		await router.handleEvent(
			event({
				type: "tool_execution_end",
				toolCallId: "tc1",
				toolName: "bash",
				isError: true,
				result: "boom",
			}),
		);
		expect(toasts).toHaveLength(1);
		expect(toasts[0].event).toBe("toolError");
	});

	it("does NOT fire on short bash (below threshold)", async () => {
		const { router, toasts } = makeRouter({});
		await router.handleEvent(
			event({ type: "tool_execution_start", toolCallId: "tc2", toolName: "bash", args: "" }),
		);
		await router.handleEvent(
			event({
				type: "tool_execution_end",
				toolCallId: "tc2",
				toolName: "bash",
				isError: false,
				result: "",
			}),
		);
		expect(toasts).toHaveLength(0);
	});

	it("fires on long bash (threshold 0)", async () => {
		const { router, toasts } = makeRouter({ config: { bashThresholdMs: 0 } });
		await router.handleEvent(
			event({ type: "tool_execution_start", toolCallId: "tc3", toolName: "bash", args: "" }),
		);
		await router.handleEvent(
			event({
				type: "tool_execution_end",
				toolCallId: "tc3",
				toolName: "bash",
				isError: false,
				result: "",
			}),
		);
		expect(toasts).toHaveLength(1);
		expect(toasts[0].event).toBe("longBash");
	});

	it("skips when events.agentEnd is false", async () => {
		const { router, toasts } = makeRouter({ config: { events: { agentEnd: false } } });
		await router.handleEvent(event({ type: "agent_end" }));
		expect(toasts).toHaveLength(0);
	});

	it("skips toast when channels.toast is false", async () => {
		const { router, toasts } = makeRouter({
			config: { channels: { toast: false, osc: false, os: false } },
		});
		await router.handleEvent(event({ type: "agent_end" }));
		expect(toasts).toHaveLength(0);
	});

	it("skips everything when enabled is false", async () => {
		const { router, toasts } = makeRouter({ config: { enabled: false } });
		await router.handleEvent(event({ type: "agent_end" }));
		await router.handleEvent(
			event({
				type: "tool_execution_end",
				toolCallId: "tc4",
				toolName: "bash",
				isError: true,
				result: "",
			}),
		);
		expect(toasts).toHaveLength(0);
	});

	it("emits toastOnly payload for compaction_end", async () => {
		const { router, toasts } = makeRouter({});
		await router.handleEvent(event({ type: "compaction_end", result: {} }));
		expect(toasts).toHaveLength(1);
		expect(toasts[0].event).toBe("compactionEnd");
		expect(toasts[0].toastOnly).toBe(true);
	});

	it("skips compaction_end when aborted", async () => {
		const { router, toasts } = makeRouter({});
		await router.handleEvent(event({ type: "compaction_end", aborted: true }));
		expect(toasts).toHaveLength(0);
	});
});

describe("NotificationRouter.notifyNeedsInput", () => {
	it("fires needsInput via the global hook", async () => {
		const { router, toasts } = makeRouter({});
		await router.notifyNeedsInput();
		expect(toasts).toHaveLength(1);
		expect(toasts[0].event).toBe("needsInput");
	});

	it("skips when events.needsInput is false", async () => {
		const { router, toasts } = makeRouter({ config: { events: { needsInput: false } } });
		await router.notifyNeedsInput();
		expect(toasts).toHaveLength(0);
	});
});

describe("NotificationRouter setters", () => {
	it("setEnabled toggles runtime behavior", async () => {
		const { router, toasts } = makeRouter({});
		router.setEnabled(false);
		await router.handleEvent(event({ type: "agent_end" }));
		expect(toasts).toHaveLength(0);
		router.setEnabled(true);
		await router.handleEvent(event({ type: "agent_end" }));
		expect(toasts).toHaveLength(1);
	});

	it("setBashThresholdMs updates threshold", async () => {
		const { router, toasts } = makeRouter({});
		router.setBashThresholdMs(0);
		await router.handleEvent(
			event({ type: "tool_execution_start", toolCallId: "tc5", toolName: "bash", args: "" }),
		);
		await router.handleEvent(
			event({
				type: "tool_execution_end",
				toolCallId: "tc5",
				toolName: "bash",
				isError: false,
				result: "",
			}),
		);
		expect(toasts).toHaveLength(1);
		expect(toasts[0].event).toBe("longBash");
	});
});

// Silence unused mock import warning while keeping the API available for future tests.
void mock;
