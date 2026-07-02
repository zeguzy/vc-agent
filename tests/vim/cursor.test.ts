import { describe, expect, it } from "bun:test";
import {
	clampToNonEmpty,
	firstNonEmptyCol,
	lastNonEmptyCol,
	rowHasContent,
} from "../../src/tui/vim/cursor.js";
import type { ScreenCell } from "../../src/tui/vim/types.js";

function cell(char: string): ScreenCell {
	return { char, isEmpty: char === " " };
}

function makeModel(lines: string[]): ScreenCell[][] {
	return lines.map((line) => Array.from(line).map(cell));
}

describe("lastNonEmptyCol", () => {
	it("returns the last non-empty column", () => {
		const model = makeModel(["hello   "]);
		expect(lastNonEmptyCol(model, 0)).toBe(4);
	});

	it("returns 0 when entire row is empty", () => {
		const model = makeModel(["   "]);
		expect(lastNonEmptyCol(model, 0)).toBe(0);
	});

	it("returns last index when row is full", () => {
		const model = makeModel(["abc"]);
		expect(lastNonEmptyCol(model, 0)).toBe(2);
	});

	it("handles single non-empty cell", () => {
		const model = makeModel(["  x  "]);
		expect(lastNonEmptyCol(model, 0)).toBe(2);
	});

	it("returns 0 for missing row", () => {
		const model = makeModel(["abc"]);
		expect(lastNonEmptyCol(model, 5)).toBe(0);
	});
});

describe("firstNonEmptyCol", () => {
	it("returns first non-empty column", () => {
		const model = makeModel(["  hello"]);
		expect(firstNonEmptyCol(model, 0)).toBe(2);
	});

	it("returns 0 when row starts with non-empty", () => {
		const model = makeModel(["hello"]);
		expect(firstNonEmptyCol(model, 0)).toBe(0);
	});

	it("returns 0 when entire row is empty", () => {
		const model = makeModel(["   "]);
		expect(firstNonEmptyCol(model, 0)).toBe(0);
	});
});

describe("rowHasContent", () => {
	it("returns true for row with text", () => {
		const model = makeModel(["hello", "   "]);
		expect(rowHasContent(model, 0)).toBe(true);
	});

	it("returns false for empty row", () => {
		const model = makeModel(["hello", "   "]);
		expect(rowHasContent(model, 1)).toBe(false);
	});
});

describe("clampToNonEmpty", () => {
	it("returns pos unchanged when cell is non-empty", () => {
		const model = makeModel(["hello"]);
		expect(clampToNonEmpty(model, { row: 0, col: 2 })).toEqual({ row: 0, col: 2 });
	});

	it("scans left to nearest non-empty when on empty cell", () => {
		const model = makeModel(["ab   "]);
		expect(clampToNonEmpty(model, { row: 0, col: 3 })).toEqual({ row: 0, col: 1 });
	});

	it("returns col 0 when entire row is empty", () => {
		const model = makeModel(["   "]);
		expect(clampToNonEmpty(model, { row: 0, col: 2 })).toEqual({ row: 0, col: 0 });
	});

	it("handles col beyond line length", () => {
		const model = makeModel(["ab"]);
		expect(clampToNonEmpty(model, { row: 0, col: 5 })).toEqual({ row: 0, col: 1 });
	});

	it("handles missing row", () => {
		const model = makeModel(["ab"]);
		expect(clampToNonEmpty(model, { row: 3, col: 0 })).toEqual({ row: 3, col: 0 });
	});

	it("finds non-empty cell when on trailing empty cell", () => {
		const model = makeModel(["x  "]);
		expect(clampToNonEmpty(model, { row: 0, col: 2 })).toEqual({ row: 0, col: 0 });
	});
});
