import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadMcpConfig, type McpConfig } from "../../src/mcp/config.js";

function tmpDir(): string {
	return mkdtempSync(join(tmpdir(), "mcp-cfg-"));
}

function writeJson(path: string, data: unknown): void {
	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(path, JSON.stringify(data));
}

describe("loadMcpConfig", () => {
	it("读取项目配置", () => {
		const dir = tmpDir();
		try {
			writeJson(join(dir, ".openagent", "mcp.json"), {
				foo: { type: "remote", url: "https://x" },
			});
			expect(loadMcpConfig(dir, join(dir, "absent.json"))).toEqual({
				foo: { type: "remote", url: "https://x" },
			});
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("项目配置覆盖全局（deepMerge）", () => {
		const dir = tmpDir();
		try {
			writeJson(join(dir, "global.json"), {
				foo: { type: "remote", url: "https://global" },
				bar: { type: "remote", url: "https://b" },
			});
			writeJson(join(dir, ".openagent", "mcp.json"), {
				foo: { type: "remote", url: "https://project" },
			});
			const cfg: McpConfig = loadMcpConfig(dir, join(dir, "global.json"));
			expect(cfg.foo).toEqual({ type: "remote", url: "https://project" });
			expect(cfg.bar).toEqual({ type: "remote", url: "https://b" });
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("两文件均无 → 空配置", () => {
		const dir = tmpDir();
		try {
			expect(loadMcpConfig(dir, join(dir, "absent.json"))).toEqual({});
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("无效 JSON 视为缺失，不抛", () => {
		const dir = tmpDir();
		try {
			mkdirSync(join(dir, ".openagent"), { recursive: true });
			writeFileSync(join(dir, ".openagent", "mcp.json"), "{ not json");
			expect(loadMcpConfig(dir, join(dir, "absent.json"))).toEqual({});
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
