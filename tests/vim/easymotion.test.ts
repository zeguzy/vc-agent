import { describe, expect, it } from "bun:test";
import { assignLabels, findTargets, resolveLabel } from "../../src/tui/vim/easymotion.js";
import type { Position, ScreenCell } from "../../src/tui/vim/types.js";

function cell(char: string): ScreenCell {
	return { char, isEmpty: char === " " };
}

function makeModel(lines: string[]): ScreenCell[][] {
	return lines.map((line) => Array.from(line).map(cell));
}

const KEYSET = "fjrudkeislwoaqghtyp";

describe("findTargets", () => {
	it("finds all matching characters", () => {
		const model = makeModel(["hello", "world"]);
		const targets = findTargets(model, "l");
		expect(targets).toEqual([
			{ row: 0, col: 2 },
			{ row: 0, col: 3 },
			{ row: 1, col: 3 },
		]);
	});

	it("returns empty array when no matches", () => {
		const model = makeModel(["hello"]);
		expect(findTargets(model, "z")).toEqual([]);
	});

	it("is case-sensitive", () => {
		const model = makeModel(["aAaA"]);
		expect(findTargets(model, "a")).toEqual([
			{ row: 0, col: 0 },
			{ row: 0, col: 2 },
		]);
		expect(findTargets(model, "A")).toEqual([
			{ row: 0, col: 1 },
			{ row: 0, col: 3 },
		]);
	});

	it("finds space characters in empty cells", () => {
		const model = makeModel(["a b"]);
		expect(findTargets(model, " ")).toEqual([{ row: 0, col: 1 }]);
	});
});

describe("assignLabels", () => {
	it("assigns single keys to fewer than 19 targets", () => {
		const targets: Position[] = [
			{ row: 0, col: 0 },
			{ row: 0, col: 5 },
			{ row: 1, col: 2 },
		];
		const labels = assignLabels(targets, { row: 0, col: 0 });
		expect(labels.size).toBe(3);
		expect(labels.get("f")).toEqual({ row: 0, col: 0 });
		expect(labels.get("j")).toEqual({ row: 1, col: 2 });
		expect(labels.get("r")).toEqual({ row: 0, col: 5 });
	});

	it("assigns exactly 19 single keys for 19 targets", () => {
		const targets: Position[] = [];
		for (let i = 0; i < 19; i++) {
			targets.push({ row: 0, col: i });
		}
		const labels = assignLabels(targets, { row: 0, col: 0 });
		expect(labels.size).toBe(19);
		for (let i = 0; i < 19; i++) {
			expect(labels.get(KEYSET[i])).toEqual({ row: 0, col: i });
		}
	});

	it("assigns double keys to targets beyond 19", () => {
		const targets: Position[] = [];
		for (let i = 0; i < 21; i++) {
			targets.push({ row: 0, col: i });
		}
		const labels = assignLabels(targets, { row: 0, col: 0 });
		expect(labels.size).toBe(21);

		expect(labels.has("f")).toBe(true);
		expect(labels.has("j")).toBe(true);

		const doubleLabels = [...labels.keys()].filter((k) => k.length === 2);
		expect(doubleLabels).toHaveLength(2);

		for (const dl of doubleLabels) {
			expect(dl[0]).toBe("f");
			expect(dl[1]).not.toBe("f");
		}
	});

	it("sorts targets by Manhattan distance from cursor", () => {
		const targets: Position[] = [
			{ row: 5, col: 5 },
			{ row: 0, col: 1 },
			{ row: 3, col: 3 },
		];
		const labels = assignLabels(targets, { row: 0, col: 0 });
		expect(labels.get("f")).toEqual({ row: 0, col: 1 });
		expect(labels.get("j")).toEqual({ row: 3, col: 3 });
		expect(labels.get("r")).toEqual({ row: 5, col: 5 });
	});

	it("returns empty map for zero targets", () => {
		const labels = assignLabels([], { row: 0, col: 0 });
		expect(labels.size).toBe(0);
	});

	it("distributes remaining targets across parent keys", () => {
		const targets: Position[] = [];
		for (let i = 0; i < 19 + 18 + 5; i++) {
			targets.push({ row: i, col: 0 });
		}
		const labels = assignLabels(targets, { row: 0, col: 0 });
		expect(labels.size).toBe(42);

		const singleLabels = [...labels.keys()].filter((k) => k.length === 1);
		const doubleLabels = [...labels.keys()].filter((k) => k.length === 2);
		expect(singleLabels).toHaveLength(19);
		expect(doubleLabels).toHaveLength(23);

		for (const dl of doubleLabels) {
			expect(dl.length).toBe(2);
			expect(dl[0]).not.toBe(dl[1]);
		}
	});
});

describe("resolveLabel", () => {
	it("resolves exact single-key match", () => {
		const labels = new Map<string, Position>([["f", { row: 0, col: 0 }]]);
		expect(resolveLabel("f", labels)).toEqual({ done: true, pos: { row: 0, col: 0 } });
	});

	it("resolves exact double-key match", () => {
		const labels = new Map<string, Position>([["fj", { row: 1, col: 1 }]]);
		expect(resolveLabel("fj", labels)).toEqual({ done: true, pos: { row: 1, col: 1 } });
	});

	it("auto-completes when prefix matches exactly one label", () => {
		const labels = new Map<string, Position>([
			["fj", { row: 0, col: 0 }],
			["rk", { row: 1, col: 1 }],
		]);
		expect(resolveLabel("f", labels)).toEqual({ done: true, pos: { row: 0, col: 0 } });
	});

	it("needs more input when prefix matches multiple labels", () => {
		const labels = new Map<string, Position>([
			["fj", { row: 0, col: 0 }],
			["fr", { row: 1, col: 1 }],
		]);
		expect(resolveLabel("f", labels)).toEqual({ done: false, pos: null });
	});

	it("cancels when no label matches", () => {
		const labels = new Map<string, Position>([["f", { row: 0, col: 0 }]]);
		expect(resolveLabel("z", labels)).toEqual({ done: true, pos: null });
	});

	it("prioritizes exact match over prefix", () => {
		const labels = new Map<string, Position>([
			["j", { row: 0, col: 0 }],
			["jf", { row: 1, col: 1 }],
		]);
		const result = resolveLabel("j", labels);
		expect(result.done).toBe(true);
		expect(result.pos).toEqual({ row: 0, col: 0 });
	});

	it("handles empty labels map", () => {
		const labels = new Map<string, Position>();
		expect(resolveLabel("f", labels)).toEqual({ done: true, pos: null });
	});
});
