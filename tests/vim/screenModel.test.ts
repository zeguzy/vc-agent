import { describe, expect, it } from "bun:test";
import {
	extractText,
	findFirstNonEmpty,
	isWordChar,
	scanBuffer,
} from "../../src/tui/vim/screenModel.js";
import type { ScreenCell } from "../../src/tui/vim/types.js";

type BufferParam = Parameters<typeof scanBuffer>[0];

function encode(lines: string[], width: number, height: number): BufferParam {
	const char = new Uint32Array(width * height);
	for (let y = 0; y < lines.length && y < height; y++) {
		const chars = Array.from(lines[y]);
		for (let x = 0; x < chars.length && x < width; x++) {
			char[y * width + x] = chars[x].codePointAt(0) ?? 0;
		}
	}
	const realText = Array.from({ length: height }, (_, i) => lines[i] ?? "").join("\n");
	const realBytes = new TextEncoder().encode(realText);
	return {
		buffers: { char, bg: new Uint16Array(width * height * 4) },
		width,
		height,
		getRealCharBytes: () => realBytes,
	} as unknown as BufferParam;
}

function cell(char: string): ScreenCell {
	return { char, isEmpty: char === " " };
}

function makeModel(lines: string[]): ScreenCell[][] {
	return lines.map((line) => Array.from(line).map(cell));
}

describe("isWordChar", () => {
	it("returns true for alphanumeric and underscore", () => {
		expect(isWordChar("a")).toBe(true);
		expect(isWordChar("Z")).toBe(true);
		expect(isWordChar("0")).toBe(true);
		expect(isWordChar("9")).toBe(true);
		expect(isWordChar("_")).toBe(true);
	});

	it("returns false for non-word characters", () => {
		expect(isWordChar(" ")).toBe(false);
		expect(isWordChar(".")).toBe(false);
		expect(isWordChar("-")).toBe(false);
		expect(isWordChar("@")).toBe(false);
		expect(isWordChar("(")).toBe(false);
	});
});

describe("scanBuffer", () => {
	it("reads a simple single-line buffer", () => {
		const buf = encode(["hello"], 5, 1);
		const model = scanBuffer(buf, { x: 0, y: 0, width: 5, height: 1 });
		expect(model).toHaveLength(1);
		expect(model[0].map((c) => c.char).join("")).toBe("hello");
		expect(model[0][0]).toEqual({ char: "h", isEmpty: false });
	});

	it("reads a multi-line buffer", () => {
		const buf = encode(["ab", "cd"], 2, 2);
		const model = scanBuffer(buf, { x: 0, y: 0, width: 2, height: 2 });
		expect(model).toHaveLength(2);
		expect(model[0].map((c) => c.char).join("")).toBe("ab");
		expect(model[1].map((c) => c.char).join("")).toBe("cd");
	});

	it("decodes space (0x20) as non-empty", () => {
		const buf = encode(["a b"], 3, 1);
		const model = scanBuffer(buf, { x: 0, y: 0, width: 3, height: 1 });
		expect(model[0][0]).toEqual({ char: "a", isEmpty: false });
		expect(model[0][1]).toEqual({ char: " ", isEmpty: false });
		expect(model[0][2]).toEqual({ char: "b", isEmpty: false });
	});

	it("decodes zero code as empty", () => {
		const char = new Uint32Array(3);
		char[0] = 0;
		char[1] = 65;
		char[2] = 0;
		const realBytes = new TextEncoder().encode("\u0000A\u0000");
		const buf = {
			buffers: { char },
			width: 3,
			height: 1,
			getRealCharBytes: () => realBytes,
		} as unknown as BufferParam;
		const model = scanBuffer(buf, { x: 0, y: 0, width: 3, height: 1 });
		expect(model[0][0]).toEqual({ char: " ", isEmpty: true });
		expect(model[0][1]).toEqual({ char: "A", isEmpty: false });
		expect(model[0][2]).toEqual({ char: " ", isEmpty: true });
	});

	it("respects bounds offset", () => {
		const buf = encode(["abcdef", "ghijkl"], 6, 2);
		const model = scanBuffer(buf, { x: 2, y: 0, width: 3, height: 2 });
		expect(model[0].map((c) => c.char).join("")).toBe("cde");
		expect(model[1].map((c) => c.char).join("")).toBe("ijk");
	});

	it("handles bounds extending beyond buffer width", () => {
		const buf = encode(["ab"], 2, 1);
		const model = scanBuffer(buf, { x: 0, y: 0, width: 5, height: 1 });
		expect(model[0][0]).toEqual({ char: "a", isEmpty: false });
		expect(model[0][1]).toEqual({ char: "b", isEmpty: false });
		expect(model[0][2]).toEqual({ char: " ", isEmpty: true });
		expect(model[0][4]).toEqual({ char: " ", isEmpty: true });
	});

	it("handles bounds extending beyond buffer height", () => {
		const buf = encode(["ab"], 2, 1);
		const model = scanBuffer(buf, { x: 0, y: 0, width: 2, height: 3 });
		expect(model).toHaveLength(3);
		expect(model[0].map((c) => c.char).join("")).toBe("ab");
		expect(model[1].every((c) => c.isEmpty)).toBe(true);
		expect(model[2].every((c) => c.isEmpty)).toBe(true);
	});

	it("handles unicode characters", () => {
		const buf = encode(["café"], 4, 1);
		const model = scanBuffer(buf, { x: 0, y: 0, width: 4, height: 1 });
		expect(model[0].map((c) => c.char).join("")).toBe("café");
		expect(model[0][3]).toEqual({ char: "é", isEmpty: false });
	});
});

describe("extractText", () => {
	it("extracts a single-line range", () => {
		const model = makeModel(["hello"]);
		expect(extractText(model, { row: 0, col: 0 }, { row: 0, col: 4 })).toBe("hello");
	});

	it("extracts a partial single-line range", () => {
		const model = makeModel(["hello"]);
		expect(extractText(model, { row: 0, col: 1 }, { row: 0, col: 3 })).toBe("ell");
	});

	it("skips trailing empty cells on single line", () => {
		const model = makeModel(["ab   "]);
		expect(extractText(model, { row: 0, col: 0 }, { row: 0, col: 4 })).toBe("ab");
	});

	it("extracts a multi-line range", () => {
		const model = makeModel(["hello", "world"]);
		expect(extractText(model, { row: 0, col: 2 }, { row: 1, col: 2 })).toBe("llo\nwor");
	});

	it("skips trailing empty cells on each line of multi-line range", () => {
		const model = makeModel(["ab   ", "cd   "]);
		expect(extractText(model, { row: 0, col: 0 }, { row: 1, col: 4 })).toBe("ab\ncd");
	});

	it("returns empty string for all-empty range", () => {
		const model = makeModel(["     "]);
		expect(extractText(model, { row: 0, col: 0 }, { row: 0, col: 4 })).toBe("");
	});

	it("handles three-line range", () => {
		const model = makeModel(["abc", "def", "ghi"]);
		expect(extractText(model, { row: 0, col: 1 }, { row: 2, col: 1 })).toBe("bc\ndef\ngh");
	});
});

describe("findFirstNonEmpty", () => {
	it("finds first non-empty in first row", () => {
		const model = makeModel(["  hello"]);
		expect(findFirstNonEmpty(model)).toEqual({ row: 0, col: 2 });
	});

	it("finds first non-empty in a later row", () => {
		const model = makeModel(["   ", "  x"]);
		expect(findFirstNonEmpty(model)).toEqual({ row: 1, col: 2 });
	});

	it("returns null when all cells are empty", () => {
		const model = makeModel(["   ", "   "]);
		expect(findFirstNonEmpty(model)).toBeNull();
	});

	it("finds first cell when it is non-empty", () => {
		const model = makeModel(["hello"]);
		expect(findFirstNonEmpty(model)).toEqual({ row: 0, col: 0 });
	});

	it("returns null for empty model", () => {
		const model: ScreenCell[][] = [];
		expect(findFirstNonEmpty(model)).toBeNull();
	});
});
