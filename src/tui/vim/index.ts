import type { CliRenderer, OptimizedBuffer } from "@opentui/core";
import { renderAll } from "./overlay.js";
import { findFirstNonEmpty, findTextInModel, scanBuffer } from "./screenModel.js";
import type { Bounds, ScreenCell, VimState } from "./types.js";
import { createInitialState, handleKey } from "./vimState.js";

export interface VimOverlayOptions {
	renderer: CliRenderer;
	getBounds: () => Bounds;
	scrollBy: (delta: number) => void;
	onYank: (text: string) => void;
	getInitialCursorText?: () => string | null;
}

export interface VimOverlay {
	postProcess: (buffer: OptimizedBuffer, deltaTime: number) => void;
	handleKey: (key: string) => boolean;
	activate: () => void;
	deactivate: () => void;
	cleanup: () => void;
	getState: () => VimState;
	resetCursor: () => void;
}

export function createVimOverlay(opts: VimOverlayOptions): VimOverlay {
	let state: VimState = createInitialState();
	let active = false;
	let currentModel: ScreenCell[][] | null = null;
	let cursorInitialized = false;

	const postProcess = (buffer: OptimizedBuffer, _dt: number) => {
		if (!active) return;
		const bounds = opts.getBounds();
		currentModel = scanBuffer(buffer, bounds);
		if (!cursorInitialized && currentModel.length > 0) {
			const searchText = opts.getInitialCursorText?.() ?? null;
			const pos =
				(searchText ? findTextInModel(currentModel, searchText) : null) ??
				findFirstNonEmpty(currentModel);
			if (pos) {
				state.cursor = pos;
				cursorInitialized = true;
			}
		}
		renderAll(buffer, state, currentModel, bounds);
	};

	const handleKeyFn = (key: string): boolean => {
		if (!active || !currentModel) return false;
		const result = handleKey(key, state, currentModel);
		state = result.state;
		if (result.scrollDelta) {
			opts.scrollBy(result.scrollDelta);
		}
		if (result.yankText) {
			opts.onYank(result.yankText);
		}
		if (result.needsRender) {
			opts.renderer.requestRender();
		}
		return result.needsRender;
	};

	const activate = () => {
		if (active) return;
		active = true;
		cursorInitialized = false;
		state = createInitialState();
		opts.renderer.addPostProcessFn(postProcess);
		opts.renderer.requestRender();
	};

	const deactivate = () => {
		if (!active) return;
		active = false;
		opts.renderer.removePostProcessFn(postProcess);
		state = createInitialState();
		currentModel = null;
	};

	const cleanup = () => {
		deactivate();
	};

	const resetCursor = () => {
		state.cursor = { row: 0, col: 0 };
		cursorInitialized = false;
	};

	return {
		postProcess,
		handleKey: handleKeyFn,
		activate,
		deactivate,
		cleanup,
		getState: () => state,
		resetCursor,
	};
}
