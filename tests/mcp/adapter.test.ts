import { describe, expect, it } from "bun:test";
import { adaptToTransports } from "../../src/mcp/adapter.js";
import type { McpConfig } from "../../src/mcp/config.js";

describe("adaptToTransports", () => {
	it("local → stdio（command 拆分、environment→env、cwd）", () => {
		const cfg: McpConfig = {
			fs: {
				type: "local",
				command: ["npx", "-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
				environment: { NODE_ENV: "test" },
				cwd: "/proj",
			},
		};
		const result = adaptToTransports(cfg);
		expect(result).toEqual([
			{
				name: "fs",
				transport: {
					type: "stdio",
					command: "npx",
					args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
					env: { NODE_ENV: "test" },
					cwd: "/proj",
				},
				enabled: true,
				autoReconnect: true,
			},
		]);
	});

	it("remote → streamable-http（url、headers）", () => {
		const cfg: McpConfig = {
			api: {
				type: "remote",
				url: "https://api.example.com",
				headers: { Auth: "Bearer x" },
			},
		};
		const result = adaptToTransports(cfg);
		expect(result[0].transport).toEqual({
			type: "streamable-http",
			url: "https://api.example.com",
			headers: { Auth: "Bearer x" },
		});
	});

	it("command 单元素 → args 空", () => {
		const result = adaptToTransports({ s: { type: "local", command: ["srv"] } });
		expect(result[0].transport).toEqual({ type: "stdio", command: "srv", args: [] });
	});

	it("enabled 默认 true，可显式 false", () => {
		expect(adaptToTransports({ a: { type: "local", command: ["x"] } })[0].enabled).toBe(true);
		expect(
			adaptToTransports({ a: { type: "local", command: ["x"], enabled: false } })[0].enabled,
		).toBe(false);
	});

	it("autoReconnect 默认 true", () => {
		expect(adaptToTransports({ a: { type: "local", command: ["x"] } })[0].autoReconnect).toBe(true);
	});

	it("timeout 不映射（不出现在输出）", () => {
		const result = adaptToTransports({
			a: { type: "remote", url: "https://x", timeout: 5000 },
		});
		expect(JSON.stringify(result[0])).not.toContain("timeout");
	});
});
