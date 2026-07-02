import type { OptimizedBuffer } from "@opentui/core";
import type { Bounds, Position, ScreenCell, VimState } from "./types.js";

function invertCell(buffer: OptimizedBuffer, x: number, y: number): void {
	const base = (y * buffer.width + x) * 4;
	for (let c = 0; c < 4; c++) {
		const tmp = buffer.buffers.fg[base + c];
		buffer.buffers.fg[base + c] = buffer.buffers.bg[base + c];
		buffer.buffers.bg[base + c] = tmp;
	}
}

function normalizeRange(a: Position, b: Position): { start: Position; end: Position } {
	if (a.row < b.row || (a.row === b.row && a.col <= b.col)) {
		return { start: a, end: b };
	}
	return { start: b, end: a };
}

export function renderAll(
	buffer: OptimizedBuffer,
	state: VimState,
	model: ScreenCell[][],
	bounds: Bounds,
): void {
	if (state.easymotion) {
		for (const [label, pos] of state.easymotion.labels) {
			if (!label.startsWith(state.easymotion.typed)) {
				continue;
			}
			const x = bounds.x + pos.col;
			const y = bounds.y + pos.row;
			if (x < 0 || y < 0 || x >= buffer.width || y >= buffer.height) {
				continue;
			}
			invertCell(buffer, x, y);
			const nextChar = label[state.easymotion.typed.length];
			if (nextChar) {
				buffer.buffers.char[y * buffer.width + x] = nextChar.codePointAt(0) ?? 0x20;
			}
		}
		return;
	}

	if (state.mode === "visual" && state.visualAnchor) {
		const { start, end } = normalizeRange(state.visualAnchor, state.cursor);
		for (let row = start.row; row <= end.row; row++) {
			const modelRow = model[row];
			if (!modelRow) continue;
			const colStart = row === start.row ? start.col : 0;
			const colEnd = row === end.row ? end.col : modelRow.length - 1;
			for (let col = colStart; col <= colEnd; col++) {
				const x = bounds.x + col;
				const y = bounds.y + row;
				if (x < 0 || y < 0 || x >= buffer.width || y >= buffer.height) {
					continue;
				}
				invertCell(buffer, x, y);
			}
		}
	}

	if (state.mode !== "visual" && state.cursor.row < model.length) {
		const modelRow = model[state.cursor.row];
		if (modelRow && state.cursor.col < modelRow.length) {
			const cx = bounds.x + state.cursor.col;
			const cy = bounds.y + state.cursor.row;
			if (cx >= 0 && cy >= 0 && cx < buffer.width && cy < buffer.height) {
				invertCell(buffer, cx, cy);
				if (
					state.cursor.col + 1 < modelRow.length &&
					modelRow[state.cursor.col + 1]?.isContinuation
				) {
					if (cx + 1 < buffer.width) {
						invertCell(buffer, cx + 1, cy);
					}
				}
			}
		}
	}
}
