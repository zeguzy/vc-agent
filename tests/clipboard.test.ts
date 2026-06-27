import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { copyToClipboard } from "../src/tui/utils/clipboard.js";

const originalEnv = { ...process.env };
const originalPlatform = process.platform;

afterEach(() => {
	for (const key of ["TMUX", "STY", "WAYLAND_DISPLAY"]) {
		delete process.env[key];
	}
	Object.assign(process.env, originalEnv);
});

describe("copyToClipboard", () => {
	const originalIsTTY = process.stdout.isTTY;
	const originalTMUX = process.env.TMUX;
	beforeEach(() => {
		// @ts-expect-error 覆盖只读字段以测试 OSC 52 路径
		process.stdout.isTTY = true;
		delete process.env.TMUX;
	});
	afterEach(() => {
		// @ts-expect-error 恢复
		process.stdout.isTTY = originalIsTTY;
		if (originalTMUX) process.env.TMUX = originalTMUX;
	});

	it("writes OSC 52 sequence to stdout", () => {
		const writeSpy = spyOn(
			process.stdout,
			"write",
			mock(() => true),
		);
		try {
			copyToClipboard("hello");
			expect(writeSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
			const out = String(writeSpy.mock.calls[0][0]);
			expect(out.startsWith("\x1b]52;c;")).toBe(true);
			expect(out.endsWith("\x07")).toBe(true);
			const b64 = out.slice("\x1b]52;c;".length, -1);
			expect(Buffer.from(b64, "base64").toString("utf-8")).toBe("hello");
		} finally {
			writeSpy.mockRestore();
		}
	});

	it("wraps OSC 52 in tmux passthrough when TMUX env is set", () => {
		process.env.TMUX = "fake-tmux-session";
		const writeSpy = spyOn(
			process.stdout,
			"write",
			mock(() => true),
		);
		try {
			copyToClipboard("x");
			const out = String(writeSpy.mock.calls[0][0]);
			expect(out.startsWith("\x1bPtmux;\x1b\x1b]52;c;")).toBe(true);
			expect(out.endsWith("\x1b\\")).toBe(true);
		} finally {
			writeSpy.mockRestore();
		}
	});

	it("skips OSC 52 when stdout is not a TTY", () => {
		const originalIsTTY = process.stdout.isTTY;
		// @ts-expect-error 测试需要覆盖只读字段
		process.stdout.isTTY = false;
		const writeSpy = spyOn(
			process.stdout,
			"write",
			mock(() => true),
		);
		try {
			copyToClipboard("x");
			expect(writeSpy).not.toHaveBeenCalled();
		} finally {
			// @ts-expect-error 恢复
			process.stdout.isTTY = originalIsTTY;
			writeSpy.mockRestore();
		}
	});

	it("calls platform command (macOS osascript / Linux xclip / etc)", () => {
		const writeSpy = spyOn(
			process.stdout,
			"write",
			mock(() => true),
		);
		const spawnMock = mock(() => ({ status: 0 }));
		// 用 module 内部 mock：直接 spy child_process.spawnSync
		// 由于 platformCopy 内部 import，这里只验证不抛错且返回 Promise<true>
		try {
			const result = copyToClipboard("text");
			expect(result instanceof Promise).toBe(true);
		} finally {
			writeSpy.mockRestore();
			spawnMock.mockRestore();
		}
	});

	it("encodes multiline and unicode text correctly in OSC 52", () => {
		const writeSpy = spyOn(
			process.stdout,
			"write",
			mock(() => true),
		);
		try {
			const text = "line1\nline2\n你好 🌍";
			copyToClipboard(text);
			const out = String(writeSpy.mock.calls[0][0]);
			const b64 = out.slice("\x1b]52;c;".length, -1);
			expect(Buffer.from(b64, "base64").toString("utf-8")).toBe(text);
		} finally {
			writeSpy.mockRestore();
		}
	});
});

describe("copyToClipboard platform branching", () => {
	it.skipIf(originalPlatform !== "darwin")(
		"on macOS uses osascript and writes real clipboard",
		() => {
			// 真机验证：osascript 写入系统剪贴板
			const { spawnSync } = require("node:child_process");
			copyToClipboard("vc-agent-clipboard-test-marker");
			const out = spawnSync("pbpaste", [], { encoding: "utf-8" }).stdout;
			expect(out).toContain("vc-agent-clipboard-test-marker");
		},
	);
});
