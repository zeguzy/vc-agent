import type { OptimizedBuffer } from "@opentui/core";
import type { Bounds, Position, ScreenCell } from "./types.js";

export function isWordChar(c: string): boolean {
	return /^[a-zA-Z0-9_]$/.test(c);
}

function isContinuationCell(rawCode: number): boolean {
	return rawCode >>> 30 === 0b11;
}

function decodeCellFromText(rawCode: number, textChar: string): ScreenCell {
	const cleanCode = rawCode & 0x3fffffff;
	if (cleanCode === 0) {
		return { char: " ", isEmpty: true };
	}
	return { char: textChar, isEmpty: false };
}

export function scanBuffer(buffer: OptimizedBuffer, bounds: Bounds): ScreenCell[][] {
	const { char } = buffer.buffers;
	const realBytes = buffer.getRealCharBytes(true);
	const realLines = new TextDecoder().decode(realBytes).split("\n");
	const model: ScreenCell[][] = [];

	for (let row = 0; row < bounds.height; row++) {
		const y = bounds.y + row;
		const line: ScreenCell[] = [];
		const textChars = [...(realLines[y] ?? "")];

		let textIdx = 0;
		for (let x = 0; x < bounds.x; x++) {
			if (y >= 0 && y < buffer.height && x >= 0 && x < buffer.width) {
				if (!isContinuationCell(char[y * buffer.width + x])) textIdx++;
			}
		}

		for (let col = 0; col < bounds.width; col++) {
			const x = bounds.x + col;
			if (y < 0 || y >= buffer.height || x < 0 || x >= buffer.width) {
				line.push({ char: " ", isEmpty: true });
				continue;
			}
			const rawCode = char[y * buffer.width + x];
			if (isContinuationCell(rawCode)) {
				line.push({ char: "", isEmpty: true, isContinuation: true });
				continue;
			}
			if (textIdx >= textChars.length) {
				line.push({ char: " ", isEmpty: true });
				continue;
			}
			const ch = textChars[textIdx] ?? " ";
			textIdx++;
			const cell = decodeCellFromText(rawCode, ch);
			line.push(cell);
		}

		model.push(line);
	}

	return model;
}

function extractLineRange(
	model: ScreenCell[][],
	row: number,
	startCol: number,
	endCol: number,
): string {
	const line = model[row];
	if (!line || line.length === 0) return "";
	const minCol = Math.max(0, startCol);
	const maxCol = Math.min(endCol, line.length - 1);

	let lastNonEmpty = -1;
	for (let col = maxCol; col >= minCol; col--) {
		if (!line[col].isEmpty) {
			lastNonEmpty = col;
			break;
		}
	}
	if (lastNonEmpty < 0) return "";

	let result = "";
	for (let col = minCol; col <= lastNonEmpty; col++) {
		result += line[col].char;
	}
	return result;
}

export function extractText(model: ScreenCell[][], start: Position, end: Position): string {
	if (start.row === end.row) {
		return extractLineRange(model, start.row, start.col, end.col);
	}

	const parts: string[] = [];
	parts.push(extractLineRange(model, start.row, start.col, model[start.row].length - 1));
	for (let row = start.row + 1; row < end.row; row++) {
		parts.push(extractLineRange(model, row, 0, model[row].length - 1));
	}
	parts.push(extractLineRange(model, end.row, 0, end.col));
	return parts.join("\n");
}

export function findFirstNonEmpty(model: ScreenCell[][]): Position | null {
	for (let row = 0; row < model.length; row++) {
		const line = model[row];
		for (let col = 0; col < line.length; col++) {
			if (!line[col].isEmpty) {
				return { row, col };
			}
		}
	}
	return null;
}

export function findTextInModel(model: ScreenCell[][], searchText: string): Position | null {
	if (!searchText) return null;

	for (let row = model.length - 1; row >= 0; row--) {
		const line = model[row];
		if (!line) continue;

		const chars: string[] = [];
		for (let col = 0; col < line.length; col++) {
			if (!line[col].isContinuation) {
				chars.push(line[col].char);
			}
		}

		const rowText = chars.join("");
		const idx = rowText.indexOf(searchText);
		if (idx >= 0) {
			let charIdx = 0;
			for (let col = 0; col < line.length; col++) {
				if (line[col].isContinuation) continue;
				if (charIdx >= idx && !line[col].isEmpty && line[col].char !== " ") {
					return { row, col };
				}
				charIdx++;
			}
		}
	}
	return null;
}
