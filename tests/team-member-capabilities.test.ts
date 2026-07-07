import { describe, expect, it } from "bun:test";
import { buildToolContractLayer } from "../src/teams/context.js";

describe("buildToolContractLayer", () => {
	it("includes only tools actually assigned", () => {
		const layer = buildToolContractLayer({ tools: ["read", "bash", "memory", "message"] });
		expect(layer).toContain("`read`");
		expect(layer).toContain("`bash`");
		expect(layer).toContain("`memory`");
		expect(layer).toContain("`message`");
		expect(layer).not.toContain("`edit`");
		expect(layer).not.toContain("skills:");
	});

	it("lists assigned skills when given", () => {
		const layer = buildToolContractLayer({
			tools: ["read", "memory", "message"],
			skills: ["backend-conventions", "testing"],
		});
		expect(layer).toContain("`backend-conventions`");
		expect(layer).toContain("`testing`");
	});

	it("lists assigned MCPs when mcp tool is included", () => {
		const layer = buildToolContractLayer({
			tools: ["read", "mcp", "memory", "message"],
			mcps: ["postgres", "github"],
		});
		expect(layer).toContain("`postgres`");
		expect(layer).toContain("`github`");
	});

	it("omits MCP section when mcp tool not in tools", () => {
		const layer = buildToolContractLayer({
			tools: ["read", "memory", "message"],
			mcps: ["postgres"],
		});
		expect(layer).not.toContain("`postgres`");
		expect(layer).not.toContain("`mcp`");
	});
});
