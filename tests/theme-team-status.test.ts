import { describe, expect, test } from "bun:test";
import { colors, teamStatusColor, teamStatusIcon } from "../src/tui/utils/theme.js";

describe("teamStatusIcon", () => {
	test("active → ◌", () => {
		expect(teamStatusIcon("active")).toBe("◌");
	});
	test("idle → ○", () => {
		expect(teamStatusIcon("idle")).toBe("○");
	});
	test("done → ✓", () => {
		expect(teamStatusIcon("done")).toBe("✓");
	});
	test("error → ✗", () => {
		expect(teamStatusIcon("error")).toBe("✗");
	});
	test("paused → ⏸", () => {
		expect(teamStatusIcon("paused")).toBe("⏸");
	});
	test("cancelled → ⊘", () => {
		expect(teamStatusIcon("cancelled")).toBe("⊘");
	});
});

describe("teamStatusColor", () => {
	test("active → warning", () => {
		expect(teamStatusColor("active")).toBe(colors.warning);
	});
	test("idle → textMuted", () => {
		expect(teamStatusColor("idle")).toBe(colors.textMuted);
	});
	test("done → success", () => {
		expect(teamStatusColor("done")).toBe(colors.success);
	});
	test("error → error", () => {
		expect(teamStatusColor("error")).toBe(colors.error);
	});
	test("paused → info", () => {
		expect(teamStatusColor("paused")).toBe(colors.info);
	});
	test("cancelled → textMuted", () => {
		expect(teamStatusColor("cancelled")).toBe(colors.textMuted);
	});
});
