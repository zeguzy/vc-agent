import { describe, expect, it } from "bun:test";
import { McpManager, nextReconnectDelay } from "../../src/mcp/manager.js";

describe("nextReconnectDelay", () => {
	it("线性退避：base * (attempt + 1)", () => {
		expect(nextReconnectDelay(0, 100, 5)).toBe(100);
		expect(nextReconnectDelay(1, 100, 5)).toBe(200);
		expect(nextReconnectDelay(4, 100, 5)).toBe(500);
	});

	it("达 max 次返回 null（停止重连）", () => {
		expect(nextReconnectDelay(5, 100, 5)).toBeNull();
		expect(nextReconnectDelay(6, 100, 5)).toBeNull();
	});

	it("负 attempt 返回 null", () => {
		expect(nextReconnectDelay(-1)).toBeNull();
	});
});

describe("McpManager smoke（无外部 server）", () => {
	it("initialize([]) 后 getAllStatus / listTools 为空", async () => {
		const m = new McpManager();
		await m.initialize([]);
		expect(m.getAllStatus()).toEqual([]);
		expect(m.listTools()).toEqual([]);
		await m.disconnectAll();
	});

	it("未连接 server 的 callTool 抛错", async () => {
		const m = new McpManager();
		await expect(m.callTool("nope", "t", undefined)).rejects.toThrow(/not connected/);
	});

	it("reconnect 未知 server 为 no-op（不抛）", async () => {
		const m = new McpManager();
		await m.reconnect("unknown");
		expect(m.getAllStatus()).toEqual([]);
	});
});
