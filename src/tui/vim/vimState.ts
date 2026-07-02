import { clampToNonEmpty, lastNonEmptyCol } from "./cursor.js";
import { assignLabels, findTargets, resolveLabel } from "./easymotion.js";
import * as motions from "./motions.js";
import { extractText } from "./screenModel.js";
import type { HandleResult, Position, ScreenCell, VimState } from "./types.js";

export function createInitialState(): VimState {
	return {
		mode: "normal",
		cursor: { row: 0, col: 0 },
		pending: null,
		easymotion: null,
		visualAnchor: null,
		countStr: null,
	};
}

function cloneState(state: VimState): VimState {
	return {
		mode: state.mode,
		cursor: { ...state.cursor },
		pending: state.pending ? { ...state.pending } : null,
		easymotion: state.easymotion
			? {
					char: state.easymotion.char,
					labels: state.easymotion.labels,
					typed: state.easymotion.typed,
				}
			: null,
		visualAnchor: state.visualAnchor ? { ...state.visualAnchor } : null,
		countStr: state.countStr,
	};
}

function normalizeRange(a: Position, b: Position): { start: Position; end: Position } {
	if (a.row < b.row || (a.row === b.row && a.col <= b.col)) {
		return { start: a, end: b };
	}
	return { start: b, end: a };
}

function applyMotionN(
	model: ScreenCell[][],
	pos: Position,
	motion: (model: ScreenCell[][], pos: Position) => Position,
	count: number,
): Position {
	let result = pos;
	for (let i = 0; i < count; i++) {
		result = motion(model, result);
	}
	return result;
}

export function handleKey(key: string, state: VimState, model: ScreenCell[][]): HandleResult {
	const newState = cloneState(state);
	let scrollDelta: number | undefined;
	let yankText: string | undefined;
	let needsRender = false;

	// 空 model 下任何操作都无意义且可能越界（G/yy 等会算出 row=-1）
	if (model.length === 0) return { state: newState, needsRender: false };

	if (newState.easymotion) {
		if (key === "escape") {
			newState.easymotion = null;
			needsRender = true;
			return { state: newState, needsRender };
		}
		const result = resolveLabel(newState.easymotion.typed + key, newState.easymotion.labels);
		if (result.done) {
			if (result.pos) {
				newState.cursor = result.pos;
			}
			newState.easymotion = null;
		} else {
			newState.easymotion = {
				...newState.easymotion,
				typed: newState.easymotion.typed + key,
			};
		}
		needsRender = true;
		return { state: newState, needsRender };
	}

	if (newState.pending) {
		const pending = newState.pending;

		// operator 后接 count（y4h / d3w）；findChar/tillChar/easymotion/gotoLine
		// 后接的是目标字符，数字不可当 count，否则 f4（找字符 '4'）会坏
		if (pending.type === "yank" && /^[1-9]$/.test(key)) {
			pending.motionCountStr = (pending.motionCountStr ?? "") + key;
			return { state: newState, needsRender: false };
		}
		if (pending.type === "yank" && key === "0" && pending.motionCountStr) {
			pending.motionCountStr += "0";
			return { state: newState, needsRender: false };
		}

		if (pending.type === "findChar" || pending.type === "tillChar") {
			newState.pending = null;
			const cnt = pending.count ?? 1;
			const result = motions.findChar(model, newState.cursor, key, {
				till: pending.type === "tillChar",
				backward: pending.backward ?? false,
				count: cnt,
			});
			if (result) {
				newState.cursor = clampToNonEmpty(model, result);
			}
			needsRender = true;
			return { state: newState, needsRender };
		}

		if (pending.type === "easymotion") {
			newState.pending = null;
			const targets = findTargets(model, key);
			if (targets.length === 0) {
				needsRender = true;
				return { state: newState, needsRender };
			}
			const labels = assignLabels(targets, newState.cursor);
			newState.easymotion = { char: key, labels, typed: "" };
			needsRender = true;
			return { state: newState, needsRender };
		}

		if (pending.type === "gotoLine") {
			newState.pending = null;
			if (key === "g") {
				const cnt = pending.count ?? 1;
				// 无 count 的 gg 跳文档顶：交由 overlay 绝对滚动
				if (cnt === 1) {
					return { state: newState, needsRender: true, scrollEdge: "top" };
				}
				const targetRow = Math.min(cnt - 1, model.length - 1);
				newState.cursor = clampToNonEmpty(
					model,
					motions.firstNonBlank(model, { row: targetRow, col: 0 }),
				);
			}
			needsRender = true;
			return { state: newState, needsRender };
		}

		if (pending.type === "yank") {
			newState.pending = null;
			// operator-count × motion-count（vim 规范：4y3h = yank 12 字符）
			const motionCount = pending.motionCountStr ? Number.parseInt(pending.motionCountStr, 10) : 1;
			const cnt = (pending.count ?? 1) * motionCount;

			if (key === "y") {
				const endRow = Math.min(newState.cursor.row + cnt - 1, model.length - 1);
				yankText = extractText(
					model,
					{ row: newState.cursor.row, col: 0 },
					{ row: endRow, col: lastNonEmptyCol(model, endRow) },
				);
				needsRender = true;
				return { state: newState, yankText, needsRender };
			}

			// j/k 是 linewise yank：y2j = 当前行 + 下方 2 行（共 3 行），count 是步数
			if (key === "j" || key === "k") {
				const step = key === "j" ? cnt : -cnt;
				const targetRow = Math.max(0, Math.min(newState.cursor.row + step, model.length - 1));
				const startRow = Math.min(newState.cursor.row, targetRow);
				const endRow = Math.max(newState.cursor.row, targetRow);
				yankText = extractText(
					model,
					{ row: startRow, col: 0 },
					{ row: endRow, col: lastNonEmptyCol(model, endRow) },
				);
				newState.cursor = { row: startRow, col: newState.cursor.col };
				needsRender = true;
				return { state: newState, yankText, needsRender };
			}

			const startPos = { ...newState.cursor };
			const target = resolveYankMotion(model, startPos, key, cnt);
			if (target) {
				const { start, end } = normalizeRange(startPos, target);
				yankText = extractText(model, start, end);
				newState.cursor = start;
			}
			needsRender = true;
			return { state: newState, yankText, needsRender };
		}

		return { state: newState, needsRender };
	}

	if (/^[1-9]$/.test(key)) {
		newState.countStr = (newState.countStr ?? "") + key;
		return { state: newState, needsRender: false };
	}
	if (key === "0" && newState.countStr) {
		newState.countStr += "0";
		return { state: newState, needsRender: false };
	}

	const count = newState.countStr ? Number.parseInt(newState.countStr, 10) : 1;
	newState.countStr = null;

	switch (key) {
		case "h": {
			newState.cursor = clampToNonEmpty(
				model,
				applyMotionN(model, newState.cursor, motions.charLeft, count),
			);
			needsRender = true;
			break;
		}
		case "l": {
			newState.cursor = clampToNonEmpty(
				model,
				applyMotionN(model, newState.cursor, motions.charRight, count),
			);
			needsRender = true;
			break;
		}
		case "j": {
			for (let i = 0; i < count; i++) {
				const next = motions.charDown(model, newState.cursor);
				if (next.row === newState.cursor.row) {
					scrollDelta = 1;
					break;
				}
				newState.cursor = clampToNonEmpty(model, next);
			}
			needsRender = true;
			break;
		}
		case "k": {
			for (let i = 0; i < count; i++) {
				const next = motions.charUp(model, newState.cursor);
				if (next.row === newState.cursor.row) {
					scrollDelta = -1;
					break;
				}
				newState.cursor = clampToNonEmpty(model, next);
			}
			needsRender = true;
			break;
		}
		case "w": {
			newState.cursor = clampToNonEmpty(
				model,
				applyMotionN(model, newState.cursor, motions.wordForward, count),
			);
			needsRender = true;
			break;
		}
		case "b": {
			newState.cursor = clampToNonEmpty(
				model,
				applyMotionN(model, newState.cursor, motions.wordBackward, count),
			);
			needsRender = true;
			break;
		}
		case "e": {
			newState.cursor = clampToNonEmpty(
				model,
				applyMotionN(model, newState.cursor, motions.wordEnd, count),
			);
			needsRender = true;
			break;
		}
		case "0": {
			newState.cursor = clampToNonEmpty(model, motions.lineStart(newState.cursor));
			needsRender = true;
			break;
		}
		case "$": {
			newState.cursor = clampToNonEmpty(model, motions.lineEnd(model, newState.cursor));
			needsRender = true;
			break;
		}
		case "^": {
			newState.cursor = clampToNonEmpty(model, motions.firstNonBlank(model, newState.cursor));
			needsRender = true;
			break;
		}
		case "f": {
			newState.pending = { type: "findChar", backward: false, count };
			break;
		}
		case "F": {
			newState.pending = { type: "findChar", backward: true, count };
			break;
		}
		case "t": {
			newState.pending = { type: "tillChar", backward: false, count };
			break;
		}
		case "T": {
			newState.pending = { type: "tillChar", backward: true, count };
			break;
		}
		case "s": {
			newState.pending = { type: "easymotion" };
			break;
		}
		case "g": {
			newState.pending = { type: "gotoLine", count };
			break;
		}
		case "G": {
			// 无 count 的 G 跳文档底：视口扫描看不到全文，交由 overlay 绝对滚动
			if (count === 1) {
				return { state: newState, needsRender: true, scrollEdge: "bottom" };
			}
			const targetRow = Math.min(count - 1, model.length - 1);
			newState.cursor = clampToNonEmpty(
				model,
				motions.firstNonBlank(model, { row: targetRow, col: 0 }),
			);
			needsRender = true;
			break;
		}
		case "v": {
			if (newState.mode === "visual") {
				newState.mode = "normal";
				newState.visualAnchor = null;
			} else {
				newState.mode = "visual";
				newState.visualAnchor = { ...newState.cursor };
			}
			needsRender = true;
			break;
		}
		case "y": {
			if (newState.mode === "visual" && newState.visualAnchor) {
				const { start, end } = normalizeRange(newState.visualAnchor, newState.cursor);
				yankText = extractText(model, start, end);
				newState.mode = "normal";
				newState.visualAnchor = null;
				needsRender = true;
			} else {
				newState.pending = { type: "yank", count };
			}
			break;
		}
		case "Y": {
			const endRow = Math.min(newState.cursor.row + count - 1, model.length - 1);
			yankText = extractText(
				model,
				{ row: newState.cursor.row, col: 0 },
				{ row: endRow, col: lastNonEmptyCol(model, endRow) },
			);
			needsRender = true;
			break;
		}
		case "escape": {
			if (newState.mode === "visual") {
				newState.mode = "normal";
				newState.visualAnchor = null;
				needsRender = true;
			}
			break;
		}
		default:
			break;
	}

	return { state: newState, scrollDelta, yankText, needsRender };
}

function resolveYankMotion(
	model: ScreenCell[][],
	pos: Position,
	key: string,
	count: number,
): Position | null {
	switch (key) {
		case "w":
			return applyMotionN(model, pos, motions.wordForward, count);
		case "b":
			return applyMotionN(model, pos, motions.wordBackward, count);
		case "e":
			return applyMotionN(model, pos, motions.wordEnd, count);
		case "$":
			return motions.lineEnd(model, pos);
		case "0":
			return motions.lineStart(pos);
		case "^":
			return motions.firstNonBlank(model, pos);
		case "h":
			return applyMotionN(model, pos, motions.charLeft, count);
		case "l":
			return applyMotionN(model, pos, motions.charRight, count);
		default:
			return null;
	}
}
