import { describe, expect, it } from "bun:test";
import { buildMemberCapabilitiesSection } from "../src/teams/context.js";

describe("buildMemberCapabilitiesSection", () => {
	it("includes only tools actually assigned", () => {
		const section = buildMemberCapabilitiesSection({
			tools: ["read", "bash", "memory", "message"],
		});
		expect(section).toContain("`read`");
		expect(section).toContain("`bash`");
		expect(section).toContain("`memory`");
		expect(section).toContain("`message`");
		expect(section).not.toContain("`edit`");
		expect(section).not.toContain("skills:");
	});

	it("emits edit/write bullets when those tools are present", () => {
		const section = buildMemberCapabilitiesSection({
			tools: ["read", "edit", "write", "memory", "message"],
		});
		expect(section).toContain("`edit`");
		expect(section).toContain("Use `edit` for targeted changes");
		expect(section).toContain("Use `write` to create new files");
	});

	it("lists assigned skills when given", () => {
		const section = buildMemberCapabilitiesSection({
			tools: ["read", "memory", "message"],
			skills: ["backend-conventions", "testing"],
		});
		expect(section).toContain("skills:");
		expect(section).toContain("`backend-conventions`");
		expect(section).toContain("`testing`");
	});

	it("lists assigned MCPs when mcp tool is included", () => {
		const section = buildMemberCapabilitiesSection({
			tools: ["read", "mcp", "memory", "message"],
			mcps: ["postgres", "github"],
		});
		expect(section).toContain("`mcp`");
		expect(section).toContain("`postgres`");
		expect(section).toContain("`github`");
	});

	it("omits MCP bullet when mcp tool not in tools", () => {
		const section = buildMemberCapabilitiesSection({
			tools: ["read", "memory", "message"],
			mcps: ["postgres"],
		});
		expect(section).not.toContain("`postgres`");
		expect(section).not.toContain("`mcp`");
	});

	it("always carries the reading-is-not-verification caveat", () => {
		const section = buildMemberCapabilitiesSection({
			tools: ["read"],
		});
		expect(section).toContain("Reading is not verification");
	});
});
