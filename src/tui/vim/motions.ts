import { clampToNonEmpty, firstNonEmptyCol, lastNonEmptyCol, rowHasContent } from "./cursor.js";
import { isWordChar } from "./screenModel.js";
import type { Position, ScreenCell } from "./types.js";

export function charLeft(model: ScreenCell[][], pos: Position): Position {
	const min = firstNonEmptyCol(model, pos.row);
	if (pos.col <= min) return pos;
	let col = pos.col - 1;
	const line = model[pos.row];
	if (line && col >= 0 && line[col]?.isContinuation && col > min) {
		col--;
	}
	return { row: pos.row, col: Math.max(min, col) };
}

export function charRight(model: ScreenCell[][], pos: Position): Position {
	const max = lastNonEmptyCol(model, pos.row);
	if (pos.col >= max) return pos;
	let col = pos.col + 1;
	const line = model[pos.row];
	if (line && col <= max && line[col]?.isContinuation) {
		col++;
	}
	return { row: pos.row, col: Math.min(max, col) };
}

export function charUp(model: ScreenCell[][], pos: Position): Position {
	if (model.length === 0) return pos;
	for (let row = pos.row - 1; row >= 0; row--) {
		if (rowHasContent(model, row)) {
			return clampToNonEmpty(model, { row, col: pos.col });
		}
	}
	return pos;
}

export function charDown(model: ScreenCell[][], pos: Position): Position {
	if (model.length === 0) return pos;
	for (let row = pos.row + 1; row < model.length; row++) {
		if (rowHasContent(model, row)) {
			return clampToNonEmpty(model, { row, col: pos.col });
		}
	}
	return pos;
}

export function lineStart(pos: Position): Position {
	return { row: pos.row, col: 0 };
}

export function lineEnd(model: ScreenCell[][], pos: Position): Position {
	return { row: pos.row, col: lastNonEmptyCol(model, pos.row) };
}

export function firstNonBlank(model: ScreenCell[][], pos: Position): Position {
	const line = model[pos.row];
	if (!line) return pos;
	for (let col = 0; col < line.length; col++) {
		if (!line[col].isEmpty) {
			return { row: pos.row, col };
		}
	}
	return { row: pos.row, col: 0 };
}

type CharClass = "word" | "blank" | "punct";

function classifyCell(cell: ScreenCell | null): CharClass | null {
	if (!cell) return null;
	if (cell.isEmpty || cell.char === " ") return "blank";
	return isWordChar(cell.char) ? "word" : "punct";
}

function getCell(model: ScreenCell[][], pos: Position): ScreenCell | null {
	const line = model[pos.row];
	if (!line || pos.col < 0 || pos.col >= line.length) return null;
	return line[pos.col];
}

function nextPos(model: ScreenCell[][], pos: Position): Position | null {
	const line = model[pos.row];
	if (!line) return null;
	if (pos.col + 1 < line.length) {
		return { row: pos.row, col: pos.col + 1 };
	}
	for (let row = pos.row + 1; row < model.length; row++) {
		if (rowHasContent(model, row)) {
			return { row, col: firstNonEmptyCol(model, row) };
		}
	}
	return null;
}

function prevPos(model: ScreenCell[][], pos: Position): Position | null {
	if (pos.col > 0) {
		return { row: pos.row, col: pos.col - 1 };
	}
	for (let row = pos.row - 1; row >= 0; row--) {
		if (rowHasContent(model, row)) {
			return { row, col: lastNonEmptyCol(model, row) };
		}
	}
	return null;
}

function lastValidPosition(model: ScreenCell[][]): Position {
	if (model.length === 0) return { row: 0, col: 0 };
	for (let row = model.length - 1; row >= 0; row--) {
		if (rowHasContent(model, row)) {
			return { row, col: lastNonEmptyCol(model, row) };
		}
	}
	return { row: 0, col: 0 };
}

export function wordForward(model: ScreenCell[][], pos: Position): Position {
	const startClass = classifyCell(getCell(model, pos));
	if (!startClass) return pos;

	let cur = pos;
	let next = nextPos(model, cur);
	while (next && classifyCell(getCell(model, next)) === startClass) {
		if (next.row !== cur.row) break;
		cur = next;
		next = nextPos(model, cur);
	}

	if (!next) return lastValidPosition(model);

	cur = next;
	while (classifyCell(getCell(model, cur)) === "blank") {
		const n = nextPos(model, cur);
		if (!n) return lastValidPosition(model);
		cur = n;
	}

	return cur;
}

export function wordBackward(model: ScreenCell[][], pos: Position): Position {
	let cur = prevPos(model, pos);
	if (!cur) return pos;

	while (classifyCell(getCell(model, cur)) === "blank") {
		const prev = prevPos(model, cur);
		if (!prev) return cur;
		cur = prev;
	}

	const klass = classifyCell(getCell(model, cur));
	if (!klass) return cur;

	while (true) {
		const prev = prevPos(model, cur);
		if (!prev) return cur;
		if (prev.row !== cur.row) return cur;
		if (classifyCell(getCell(model, prev)) !== klass) return cur;
		cur = prev;
	}
}

export function wordEnd(model: ScreenCell[][], pos: Position): Position {
	let cur = nextPos(model, pos);
	if (!cur) return pos;

	while (classifyCell(getCell(model, cur)) === "blank") {
		const next = nextPos(model, cur);
		if (!next) return cur;
		cur = next;
	}

	const klass = classifyCell(getCell(model, cur));
	if (!klass) return cur;

	while (true) {
		const next = nextPos(model, cur);
		if (!next) return cur;
		if (next.row !== cur.row) return cur;
		if (classifyCell(getCell(model, next)) !== klass) return cur;
		cur = next;
	}
}

export function findChar(
	model: ScreenCell[][],
	pos: Position,
	char: string,
	opts: { till?: boolean; backward?: boolean; count?: number },
): Position | null {
	const line = model[pos.row];
	if (!line) return null;
	const { till = false, backward = false, count = 1 } = opts;
	let found = 0;

	if (backward) {
		for (let col = pos.col - 1; col >= 0; col--) {
			if (line[col].char === char) {
				found++;
				if (found < count) continue;
				let resultCol = till ? col + 1 : col;
				if (till && line[resultCol]?.isContinuation) {
					resultCol++;
				}
				return { row: pos.row, col: resultCol };
			}
		}
	} else {
		for (let col = pos.col + 1; col < line.length; col++) {
			if (line[col].char === char) {
				found++;
				if (found < count) continue;
				let resultCol = till ? col - 1 : col;
				if (till && line[resultCol]?.isContinuation) {
					resultCol--;
				}
				return { row: pos.row, col: Math.max(0, resultCol) };
			}
		}
	}
	return null;
}
