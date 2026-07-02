import type { Position, ScreenCell } from "./types.js";

export function lastNonEmptyCol(model: ScreenCell[][], row: number): number {
	const line = model[row];
	if (!line) return 0;
	for (let col = line.length - 1; col >= 0; col--) {
		if (!line[col].isEmpty && line[col].char !== " ") {
			return col;
		}
	}
	return 0;
}

export function firstNonEmptyCol(model: ScreenCell[][], row: number): number {
	const line = model[row];
	if (!line) return 0;
	for (let col = 0; col < line.length; col++) {
		if (!line[col].isEmpty && line[col].char !== " ") {
			return col;
		}
	}
	return 0;
}

export function rowHasContent(model: ScreenCell[][], row: number): boolean {
	const line = model[row];
	if (!line) return false;
	return line.some((c) => !c.isEmpty && c.char !== " ");
}

export function clampToNonEmpty(model: ScreenCell[][], pos: Position): Position {
	const line = model[pos.row];
	if (!line || line.length === 0) return { row: pos.row, col: 0 };

	const max = lastNonEmptyCol(model, pos.row);
	const min = firstNonEmptyCol(model, pos.row);
	if (pos.col > max) return { row: pos.row, col: max };
	if (pos.col < min) return { row: pos.row, col: min };

	const cell = pos.col < line.length ? line[pos.col] : null;
	if (cell && !cell.isEmpty) return pos;

	for (let col = pos.col; col >= min; col--) {
		if (!line[col].isEmpty) {
			return { row: pos.row, col };
		}
	}
	return { row: pos.row, col: min };
}
