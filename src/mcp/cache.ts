import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { McpJsonConfig } from "./types.js";

/** Shape of the on-disk cache file */
export interface CacheData {
	configHash: string;
	updatedAt: string;
	servers: Array<{
		name: string;
		tools: Array<{
			name: string;
			description: string;
			inputSchema: object;
		}>;
	}>;
}

/** Return the cache file path: `~/.config/openagent/mcp-tool-cache.json` */
export function resolveCachePath(): string {
	return join(homedir(), ".config", "openagent", "mcp-tool-cache.json");
}

/**
 * Compute a stable SHA-256 hex digest of the merged mcp.json config.
 * Keys are sorted recursively to ensure semantic equivalence regardless
 * of insertion order.
 */
export function computeConfigHash(config: McpJsonConfig): string {
	const canonical = stableStringify(config);
	return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Read the cache file. Returns null if the file doesn't exist, is malformed
 * JSON, or doesn't match the expected CacheData structure. On corruption,
 * the file is deleted and a warning is logged.
 */
export function readCache(): CacheData | null {
	const path = resolveCachePath();
	if (!existsSync(path)) return null;

	try {
		const raw = readFileSync(path, "utf-8");
		const parsed: unknown = JSON.parse(raw);
		if (!isCacheData(parsed)) {
			console.warn("[mcp-cache] Cache file structure invalid, deleting:", path);
			safeUnlink(path);
			return null;
		}
		return parsed;
	} catch (err) {
		console.warn("[mcp-cache] Failed to read cache, deleting:", path, err);
		safeUnlink(path);
		return null;
	}
}

/**
 * Write cache to disk atomically: write to a temp file in the same directory,
 * then rename over the target. This prevents partial writes from corrupting
 * the cache on crash.
 */
export function writeCache(data: CacheData): void {
	const path = resolveCachePath();
	const dir = join(path, "..");
	const tmpPath = `${path}.tmp`;

	mkdirSync(dir, { recursive: true });

	try {
		writeFileSync(tmpPath, `${JSON.stringify(data, undefined, "\t")}\n`, "utf-8");
		renameSync(tmpPath, path);
	} catch (err) {
		console.warn("[mcp-cache] Failed to write cache:", err);
		safeUnlink(tmpPath);
	}
}

/** Recursive key-sorted JSON stringification */
function stableStringify(value: unknown): string {
	if (value === null || typeof value !== "object") {
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) {
		return `[${value.map(stableStringify).join(",")}]`;
	}
	const keys = Object.keys(value as Record<string, unknown>).sort();
	return (
		"{" +
		keys
			.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`)
			.join(",") +
		"}"
	);
}

/** Runtime type guard for CacheData */
function isCacheData(value: unknown): value is CacheData {
	if (value === null || typeof value !== "object") return false;
	const obj = value as Record<string, unknown>;
	if (typeof obj.configHash !== "string") return false;
	if (typeof obj.updatedAt !== "string") return false;
	if (!Array.isArray(obj.servers)) return false;
	for (const server of obj.servers) {
		if (server === null || typeof server !== "object") return false;
		const s = server as Record<string, unknown>;
		if (typeof s.name !== "string") return false;
		if (!Array.isArray(s.tools)) return false;
		for (const tool of s.tools) {
			if (tool === null || typeof tool !== "object") return false;
			const t = tool as Record<string, unknown>;
			if (typeof t.name !== "string") return false;
			if (typeof t.description !== "string") return false;
			if (typeof t.inputSchema !== "object" || t.inputSchema === null) return false;
		}
	}
	return true;
}

/** Best-effort file deletion, never throws */
function safeUnlink(path: string): void {
	try {
		unlinkSync(path);
	} catch {
		// already gone or inaccessible
	}
}
