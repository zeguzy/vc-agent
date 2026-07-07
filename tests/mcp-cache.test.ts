import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	type CacheData,
	computeConfigHash,
	readCache,
	resolveCachePath,
	writeCache,
} from "../src/mcp/cache.js";

const CACHE_PATH = resolveCachePath();
const CONFIG_DIR = join(homedir(), ".config", "openagent");

describe("computeConfigHash", () => {
	it("produces stable hash for same config regardless of key order", () => {
		const configA = {
			server1: { type: "local" as const, command: ["node", "a.js"] },
			server2: { type: "local" as const, command: ["node", "b.js"] },
		};
		const configB = {
			server2: { type: "local" as const, command: ["node", "b.js"] },
			server1: { type: "local" as const, command: ["node", "a.js"] },
		};
		expect(computeConfigHash(configA)).toBe(computeConfigHash(configB));
	});

	it("produces different hash for different configs", () => {
		const configA = {
			server1: { type: "local" as const, command: ["node", "a.js"] },
		};
		const configB = {
			server1: { type: "local" as const, command: ["node", "b.js"] },
		};
		expect(computeConfigHash(configA)).not.toBe(computeConfigHash(configB));
	});

	it("produces consistent hash across multiple calls", () => {
		const config = { s: { type: "local" as const, command: ["x"] } };
		const h1 = computeConfigHash(config);
		const h2 = computeConfigHash(config);
		expect(h1).toBe(h2);
	});
});

describe("writeCache + readCache round-trip", () => {
	beforeEach(() => {
		safeRemoveCache();
	});

	afterEach(() => {
		safeRemoveCache();
	});

	it("reads back what was written", () => {
		const data: CacheData = {
			configHash: "abc123",
			updatedAt: "2025-01-01T00:00:00Z",
			servers: [
				{
					name: "test-server",
					tools: [
						{
							name: "tool1",
							description: "A test tool",
							inputSchema: { type: "object", properties: {} },
						},
					],
				},
			],
		};
		writeCache(data);
		const read = readCache();
		expect(read).not.toBeNull();
		expect(read?.configHash).toBe("abc123");
		expect(read?.servers).toHaveLength(1);
		expect(read?.servers[0].name).toBe("test-server");
		expect(read?.servers[0].tools).toHaveLength(1);
		expect(read?.servers[0].tools[0].name).toBe("tool1");
	});
});

describe("readCache corruption tolerance", () => {
	beforeEach(() => {
		safeRemoveCache();
		mkdirSync(CONFIG_DIR, { recursive: true });
	});

	afterEach(() => {
		safeRemoveCache();
	});

	it("returns null for non-existent file", () => {
		expect(readCache()).toBeNull();
	});

	it("returns null and deletes file for invalid JSON", () => {
		writeFileSync(CACHE_PATH, "not json{{{", "utf-8");
		const result = readCache();
		expect(result).toBeNull();
		expect(existsSync(CACHE_PATH)).toBe(false);
	});

	it("returns null and deletes file for valid JSON with wrong structure", () => {
		writeFileSync(CACHE_PATH, JSON.stringify({ wrong: "shape" }), "utf-8");
		const result = readCache();
		expect(result).toBeNull();
		expect(existsSync(CACHE_PATH)).toBe(false);
	});
});

function safeRemoveCache(): void {
	try {
		unlinkSync(CACHE_PATH);
	} catch {
		// already gone
	}
	try {
		unlinkSync(`${CACHE_PATH}.tmp`);
	} catch {
		// already gone
	}
}
