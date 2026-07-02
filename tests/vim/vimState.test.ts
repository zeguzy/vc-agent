import { describe, expect, it } from "bun:test";
import { extractText } from "../../src/tui/vim/screenModel.js";
import type { HandleResult, ScreenCell, VimState } from "../../src/tui/vim/types.js";
import { createInitialState, handleKey } from "../../src/tui/vim/vimState.js";

function cell(char: string): ScreenCell {
	return { char, isEmpty: char === " " };
}

function makeModel(lines: string[]): ScreenCell[][] {
	return lines.map((line) => Array.from(line).map(cell));
}

function at(col: number, row = 0): VimState {
	return { ...createInitialState(), cursor: { row, col } };
}

function press(keys: string, init: VimState, model: ScreenCell[][]): HandleResult {
	let res: HandleResult = { state: init, needsRender: false };
	for (const k of keys) {
		res = handleKey(k, res.state, model);
	}
	return res;
}

describe("handleKey — operator-then-count (y4h)", () => {
	it("y4h yanks 4 chars left", () => {
		const model = makeModel(["hello world"]);
		const res = press("y4h", at(8), model);
		expect(res.yankText).toBe("o wor");
		expect(res.state.cursor).toEqual({ row: 0, col: 4 });
	});

	it("yh still yanks one char left (regression)", () => {
		const model = makeModel(["hello world"]);
		const res = press("yh", at(8), model);
		expect(res.yankText).toBe("or");
	});

	it("4yh still works (count before operator, regression)", () => {
		const model = makeModel(["hello world"]);
		const res = press("4yh", at(8), model);
		expect(res.yankText).toBe("o wor");
	});

	it("4y3h multiplies both counts (vim: 4*3=12)", () => {
		const model = makeModel(["hello world"]);
		const res = press("4y3h", at(8), model);
		expect(res.yankText).toBe("hello wor");
	});

	it("y10h supports multi-digit count", () => {
		const model = makeModel(["hello world"]);
		const res = press("y10h", at(10), model);
		expect(res.yankText).toBe("hello world");
	});
});

describe("handleKey — linewise yank with j/k", () => {
	function rows(): ScreenCell[][] {
		return makeModel(["abc", "def", "ghi", "jkl"]);
	}

	it("yj yanks current + next line (2 lines)", () => {
		const res = press("yj", at(0, 1), rows());
		expect(res.yankText).toBe("def\nghi");
	});

	it("y2j yanks 3 lines (count = steps)", () => {
		const res = press("y2j", at(0, 1), rows());
		expect(res.yankText).toBe("def\nghi\njkl");
	});

	it("yk yanks current + previous line, cursor moves up", () => {
		const res = press("yk", at(0, 2), rows());
		expect(res.yankText).toBe("def\nghi");
		expect(res.state.cursor.row).toBe(1);
	});

	it("y2k clamps to top line", () => {
		const res = press("y2k", at(0, 1), rows());
		expect(res.yankText).toBe("abc\ndef");
		expect(res.state.cursor.row).toBe(0);
	});

	it("yl still yanks charwise to the right (regression)", () => {
		const model = makeModel(["hello"]);
		const res = press("y3l", at(1), model);
		// charLeft/Right inclusive：col1..4 = "ello"
		expect(res.yankText).toBe("ello");
	});
});

describe("handleKey — count after operator does not break char-awaiting pendings", () => {
	it("f4 still finds the literal char '4'", () => {
		const model = makeModel(["ab4cd"]);
		const res = press("f4", at(0), model);
		expect(res.state.cursor).toEqual({ row: 0, col: 2 });
	});

	it("y0 still yanks to line start (0 is a motion, not a count)", () => {
		const model = makeModel(["hello world"]);
		const res = press("y0", at(4), model);
		expect(res.yankText).toBe("hello");
	});

	it("t3 still tills char '3'", () => {
		const model = makeModel(["ab3cd"]);
		const res = press("t3", at(0), model);
		expect(res.state.cursor).toEqual({ row: 0, col: 1 });
	});
});

describe("handleKey — empty model safety (no out-of-bounds)", () => {
	it("G on empty model keeps cursor in bounds", () => {
		const res = press("G", at(0), []);
		expect(res.state.cursor.row).toBeGreaterThanOrEqual(0);
	});

	it("gg on empty model keeps cursor in bounds", () => {
		const res = press("gg", at(0), []);
		expect(res.state.cursor.row).toBeGreaterThanOrEqual(0);
	});

	it("yy on empty model does not crash and yanks nothing", () => {
		const res = press("yy", at(0), []);
		expect(res.yankText).toBeUndefined();
	});

	it("yj on empty model does not crash", () => {
		const res = press("yj", at(0), []);
		expect(res.yankText).toBeUndefined();
	});

	it("y4h on empty model does not crash", () => {
		const res = press("y4h", at(0), []);
		expect(res.yankText).toBeUndefined();
	});

	it("motions on empty model keep cursor in bounds", () => {
		for (const key of ["h", "l", "j", "k", "w", "b", "e", "0", "$"]) {
			const res = press(key, at(0), []);
			expect(res.state.cursor.row).toBeGreaterThanOrEqual(0);
			expect(res.state.cursor.col).toBeGreaterThanOrEqual(0);
		}
	});
});

describe("extractText — robustness", () => {
	it("does not crash when start.row is out of bounds (cross-line path)", () => {
		const model = makeModel(["only"]);
		expect(() => extractText(model, { row: 5, col: 0 }, { row: 6, col: 3 })).not.toThrow();
	});
});

describe("handleKey — G/gg scroll to document edge", () => {
	it("G (count=1) signals scrollEdge bottom", () => {
		const res = press("G", at(0), makeModel(["abc", "def", "ghi"]));
		expect(res.scrollEdge).toBe("bottom");
	});

	it("gg (count=1) signals scrollEdge top", () => {
		const res = press("gg", at(2), makeModel(["abc", "def", "ghi"]));
		expect(res.scrollEdge).toBe("top");
	});

	it("count G does not signal scrollEdge (in-viewport best-effort)", () => {
		const res = press("5G", at(0), makeModel(["a", "b", "c", "d", "e"]));
		expect(res.scrollEdge).toBeUndefined();
	});

	it("count gg does not signal scrollEdge", () => {
		const res = press("3gg", at(0), makeModel(["a", "b", "c", "d"]));
		expect(res.scrollEdge).toBeUndefined();
	});
});
