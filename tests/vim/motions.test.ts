import { describe, expect, it } from "bun:test";
import {
	charDown,
	charLeft,
	charRight,
	charUp,
	findChar,
	firstNonBlank,
	lineEnd,
	lineStart,
	wordBackward,
	wordEnd,
	wordForward,
} from "../../src/tui/vim/motions.js";
import type { ScreenCell } from "../../src/tui/vim/types.js";

function cell(char: string): ScreenCell {
	return { char, isEmpty: char === " " };
}

function makeModel(lines: string[]): ScreenCell[][] {
	return lines.map((line) => Array.from(line).map(cell));
}

describe("charLeft", () => {
	it("moves left by one", () => {
		const model = makeModel(["hello"]);
		expect(charLeft(model, { row: 0, col: 3 })).toEqual({ row: 0, col: 2 });
	});

	it("stops at col 0", () => {
		const model = makeModel(["hello"]);
		expect(charLeft(model, { row: 0, col: 0 })).toEqual({ row: 0, col: 0 });
	});
});

describe("charRight", () => {
	it("moves right by one", () => {
		const model = makeModel(["hello"]);
		expect(charRight(model, { row: 0, col: 1 })).toEqual({ row: 0, col: 2 });
	});

	it("stops at last non-empty col", () => {
		const model = makeModel(["hi   "]);
		expect(charRight(model, { row: 0, col: 1 })).toEqual({ row: 0, col: 1 });
	});
});

describe("charUp", () => {
	it("moves up one row keeping col", () => {
		const model = makeModel(["hello", "world"]);
		expect(charUp(model, { row: 1, col: 2 })).toEqual({ row: 0, col: 2 });
	});

	it("stops at row 0", () => {
		const model = makeModel(["hello", "world"]);
		expect(charUp(model, { row: 0, col: 2 })).toEqual({ row: 0, col: 2 });
	});

	it("clamps col to non-empty when target row is shorter", () => {
		const model = makeModel(["hi   ", "hello"]);
		expect(charUp(model, { row: 1, col: 4 })).toEqual({ row: 0, col: 1 });
	});
});

describe("charDown", () => {
	it("moves down one row keeping col", () => {
		const model = makeModel(["hello", "world"]);
		expect(charDown(model, { row: 0, col: 2 })).toEqual({ row: 1, col: 2 });
	});

	it("stops at last row", () => {
		const model = makeModel(["hello", "world"]);
		expect(charDown(model, { row: 1, col: 2 })).toEqual({ row: 1, col: 2 });
	});

	it("clamps col to non-empty when target row is shorter", () => {
		const model = makeModel(["hello", "hi   "]);
		expect(charDown(model, { row: 0, col: 4 })).toEqual({ row: 1, col: 1 });
	});
});

describe("lineStart", () => {
	it("returns col 0", () => {
		expect(lineStart({ row: 3, col: 5 })).toEqual({ row: 3, col: 0 });
	});
});

describe("lineEnd", () => {
	it("returns last non-empty col", () => {
		const model = makeModel(["hello   "]);
		expect(lineEnd(model, { row: 0, col: 0 })).toEqual({ row: 0, col: 4 });
	});

	it("returns col 0 for empty row", () => {
		const model = makeModel(["   "]);
		expect(lineEnd(model, { row: 0, col: 0 })).toEqual({ row: 0, col: 0 });
	});
});

describe("firstNonBlank", () => {
	it("finds first non-empty cell", () => {
		const model = makeModel(["  hello"]);
		expect(firstNonBlank(model, { row: 0, col: 5 })).toEqual({ row: 0, col: 2 });
	});

	it("returns col 0 when already at first non-empty", () => {
		const model = makeModel(["hello"]);
		expect(firstNonBlank(model, { row: 0, col: 3 })).toEqual({ row: 0, col: 0 });
	});

	it("returns col 0 for empty row", () => {
		const model = makeModel(["   "]);
		expect(firstNonBlank(model, { row: 0, col: 1 })).toEqual({ row: 0, col: 0 });
	});
});

describe("wordForward", () => {
	it("moves to next word on same line", () => {
		const model = makeModel(["hello world"]);
		expect(wordForward(model, { row: 0, col: 0 })).toEqual({ row: 0, col: 6 });
	});

	it("skips single-char word", () => {
		const model = makeModel(["a b c"]);
		expect(wordForward(model, { row: 0, col: 0 })).toEqual({ row: 0, col: 2 });
	});

	it("wraps to next line at end of current line", () => {
		const model = makeModel(["hi", "world"]);
		expect(wordForward(model, { row: 0, col: 0 })).toEqual({ row: 1, col: 0 });
	});

	it("moves from word to punctuation", () => {
		const model = makeModel(["hello.world"]);
		expect(wordForward(model, { row: 0, col: 0 })).toEqual({ row: 0, col: 5 });
	});

	it("moves from punctuation to word", () => {
		const model = makeModel(["hello.world"]);
		expect(wordForward(model, { row: 0, col: 5 })).toEqual({ row: 0, col: 6 });
	});

	it("stays at last word when at end of model", () => {
		const model = makeModel(["hello"]);
		expect(wordForward(model, { row: 0, col: 0 })).toEqual({ row: 0, col: 4 });
	});
});

describe("wordBackward", () => {
	it("moves to previous word on same line", () => {
		const model = makeModel(["hello world"]);
		expect(wordBackward(model, { row: 0, col: 6 })).toEqual({ row: 0, col: 0 });
	});

	it("wraps to previous line at start of current line", () => {
		const model = makeModel(["hello", "world"]);
		expect(wordBackward(model, { row: 1, col: 0 })).toEqual({ row: 0, col: 0 });
	});

	it("moves to start of current word from middle", () => {
		const model = makeModel(["hello"]);
		expect(wordBackward(model, { row: 0, col: 3 })).toEqual({ row: 0, col: 0 });
	});

	it("stays at position 0 when already at start", () => {
		const model = makeModel(["hello"]);
		expect(wordBackward(model, { row: 0, col: 0 })).toEqual({ row: 0, col: 0 });
	});
});

describe("wordEnd", () => {
	it("moves to end of current word", () => {
		const model = makeModel(["hello world"]);
		expect(wordEnd(model, { row: 0, col: 0 })).toEqual({ row: 0, col: 4 });
	});

	it("moves to end of next word when already at word end", () => {
		const model = makeModel(["hello world"]);
		expect(wordEnd(model, { row: 0, col: 4 })).toEqual({ row: 0, col: 10 });
	});

	it("handles single-char words", () => {
		const model = makeModel(["a b c"]);
		expect(wordEnd(model, { row: 0, col: 0 })).toEqual({ row: 0, col: 2 });
	});

	it("stays at last char when at end of model", () => {
		const model = makeModel(["hello"]);
		expect(wordEnd(model, { row: 0, col: 4 })).toEqual({ row: 0, col: 4 });
	});
});

describe("findChar", () => {
	it("finds char forward", () => {
		const model = makeModel(["hello world"]);
		expect(findChar(model, { row: 0, col: 0 }, "o", {})).toEqual({ row: 0, col: 4 });
	});

	it("finds next occurrence forward (not current position)", () => {
		const model = makeModel(["aXaXa"]);
		expect(findChar(model, { row: 0, col: 0 }, "X", {})).toEqual({ row: 0, col: 1 });
	});

	it("finds char backward", () => {
		const model = makeModel(["hello world"]);
		expect(findChar(model, { row: 0, col: 10 }, "o", { backward: true })).toEqual({
			row: 0,
			col: 7,
		});
	});

	it("returns null when no match forward", () => {
		const model = makeModel(["hello"]);
		expect(findChar(model, { row: 0, col: 0 }, "z", {})).toBeNull();
	});

	it("returns null when no match backward", () => {
		const model = makeModel(["hello"]);
		expect(findChar(model, { row: 0, col: 4 }, "z", { backward: true })).toBeNull();
	});

	it("handles till forward (stops one before match)", () => {
		const model = makeModel(["hello"]);
		expect(findChar(model, { row: 0, col: 0 }, "l", { till: true })).toEqual({
			row: 0,
			col: 1,
		});
	});

	it("handles till backward (stops one after match)", () => {
		const model = makeModel(["hello"]);
		expect(findChar(model, { row: 0, col: 4 }, "e", { till: true, backward: true })).toEqual({
			row: 0,
			col: 2,
		});
	});

	it("is case-sensitive", () => {
		const model = makeModel(["aAbB"]);
		expect(findChar(model, { row: 0, col: 0 }, "a", {})).toBeNull();
		expect(findChar(model, { row: 0, col: 0 }, "A", {})).toEqual({ row: 0, col: 1 });
	});
});
