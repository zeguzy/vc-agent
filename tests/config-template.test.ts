import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deepMerge, getDefaultConfigTemplate, readConfig, writeConfig } from "../src/config.js";
import { resolveNotificationsConfig } from "../src/notifications/config.js";
import { resolveTeamConfig } from "../src/teams/types.js";

describe("getDefaultConfigTemplate", () => {
	it("contains all top-level fields with defaults", () => {
		const tmpl = getDefaultConfigTemplate();

		expect(tmpl.thinking).toEqual({ level: "medium", collapsed: false });
		expect(tmpl.providers).toEqual({});
		expect(tmpl.display).toEqual({});
		expect(tmpl.compaction).toEqual({
			enabled: true,
			reserveTokens: 4096,
			keepRecentTokens: 8192,
		});
		expect(tmpl.skills).toEqual({ paths: [], autoLoad: true, disabled: [] });
		expect(tmpl.notifications).toBeDefined();
		expect(tmpl.teams).toBeDefined();
		expect(tmpl.contextPruning).toEqual({ enabled: false });
		expect(tmpl.instructions).toEqual([]);
	});

	it("does not include the model key", () => {
		const tmpl = getDefaultConfigTemplate();
		expect(!("model" in tmpl)).toBe(true);
	});

	it("contextPruning has minimal default", () => {
		const tmpl = getDefaultConfigTemplate();
		expect(tmpl.contextPruning).toEqual({ enabled: false });
	});
});

describe("getDefaultConfigTemplate write/read round-trip", () => {
	it("can be written and read back without JSON errors", () => {
		const tmpl = getDefaultConfigTemplate();
		const dir = mkdtempSync(join(tmpdir(), "oa-cfg-test-"));
		try {
			writeConfig(dir, tmpl, "project");
			const readBack = readConfig(dir);
			expect(readBack.thinking).toEqual({ level: "medium", collapsed: false });
			expect(readBack.compaction).toEqual({
				enabled: true,
				reserveTokens: 4096,
				keepRecentTokens: 8192,
			});
			expect(readBack.skills).toEqual({ paths: [], autoLoad: true, disabled: [] });
			expect(readBack.instructions).toEqual([]);
			expect(readBack.providers).toEqual({});
			expect(readBack.display).toEqual({});
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("deepMerge of empty with template equals template", () => {
		const tmpl = getDefaultConfigTemplate();
		expect(deepMerge({}, tmpl)).toEqual(tmpl);
	});
});

describe("getDefaultConfigTemplate resolve compatibility", () => {
	it("resolveTeamConfig does not throw", () => {
		const tmpl = getDefaultConfigTemplate();
		expect(() => resolveTeamConfig(tmpl.teams)).not.toThrow();
	});

	it("resolveNotificationsConfig does not throw", () => {
		const tmpl = getDefaultConfigTemplate();
		expect(() => resolveNotificationsConfig(tmpl.notifications)).not.toThrow();
	});
});
