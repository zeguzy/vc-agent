import { clampToNonEmpty } from "./cursor.js";
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
	};
}

function normalizeRange(a: Position, b: Position): { start: Position; end: Position } {
	if (a.row < b.row || (a.row === b.row && a.col <= b.col)) {
		return { start: a, end: b };
	}
	return { start: b, end: a };
}

export function handleKey(key: string, state: VimState, model: ScreenCell[][]): HandleResult {
	const newState = cloneState(state);
	let scrollDelta: number | undefined;
	let yankText: string | undefined;
	let needsRender = false;

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
		newState.pending = null;

		if (pending.type === "findChar" || pending.type === "tillChar") {
			const result = motions.findChar(model, newState.cursor, key, {
				till: pending.type === "tillChar",
				backward: pending.backward ?? false,
			});
			if (result) {
				newState.cursor = clampToNonEmpty(model, result);
			}
			needsRender = true;
			return { state: newState, needsRender };
		}

		if (pending.type === "easymotion") {
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
			if (key === "g") {
				newState.cursor = clampToNonEmpty(model, motions.firstNonBlank(model, { row: 0, col: 0 }));
			}
			needsRender = true;
			return { state: newState, needsRender };
		}

		return { state: newState, needsRender };
	}

	switch (key) {
		case "h": {
			newState.cursor = clampToNonEmpty(model, motions.charLeft(model, newState.cursor));
			needsRender = true;
			break;
		}
		case "l": {
			newState.cursor = clampToNonEmpty(model, motions.charRight(model, newState.cursor));
			needsRender = true;
			break;
		}
		case "j": {
			const next = motions.charDown(model, newState.cursor);
			if (next.row === newState.cursor.row) {
				scrollDelta = 1;
			} else {
				newState.cursor = clampToNonEmpty(model, next);
			}
			needsRender = true;
			break;
		}
		case "k": {
			const next = motions.charUp(model, newState.cursor);
			if (next.row === newState.cursor.row) {
				scrollDelta = -1;
			} else {
				newState.cursor = clampToNonEmpty(model, next);
			}
			needsRender = true;
			break;
		}
		case "w": {
			newState.cursor = clampToNonEmpty(model, motions.wordForward(model, newState.cursor));
			needsRender = true;
			break;
		}
		case "b": {
			newState.cursor = clampToNonEmpty(model, motions.wordBackward(model, newState.cursor));
			needsRender = true;
			break;
		}
		case "e": {
			newState.cursor = clampToNonEmpty(model, motions.wordEnd(model, newState.cursor));
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
			newState.pending = { type: "findChar", backward: false };
			break;
		}
		case "F": {
			newState.pending = { type: "findChar", backward: true };
			break;
		}
		case "t": {
			newState.pending = { type: "tillChar", backward: false };
			break;
		}
		case "T": {
			newState.pending = { type: "tillChar", backward: true };
			break;
		}
		case "s": {
			newState.pending = { type: "easymotion" };
			break;
		}
		case "g": {
			newState.pending = { type: "gotoLine" };
			break;
		}
		case "G": {
			const lastRow = model.length - 1;
			newState.cursor = clampToNonEmpty(
				model,
				motions.firstNonBlank(model, { row: lastRow, col: 0 }),
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
			}
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
